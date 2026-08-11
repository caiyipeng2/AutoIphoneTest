import { AlertTriangle, LoaderCircle, RefreshCw, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type ViewportStatus = "idle" | "connecting" | "ready" | "degraded" | "unsupported" | "error";

interface VideoFramePayload {
  readonly schemaVersion: 1;
  readonly frameId: number;
  readonly serial: string;
  readonly metricsEpoch: number;
  readonly width: number;
  readonly height: number;
  readonly format: "jpeg" | "h264";
  readonly degraded: boolean;
  readonly provider: "tango" | "mjpeg" | "screenshot";
  readonly keyFrame?: boolean;
  readonly config?: boolean;
  readonly presentationTimestampUs?: string;
  readonly dataBase64: string;
}

interface VideoFrameMessage {
  readonly type: "video.frame";
  readonly frame: VideoFramePayload;
}

interface DecoderLike {
  configure(config: VideoDecoderConfig): void;
  decode(chunk: EncodedVideoChunk): void;
  close(): void;
}

interface DecoderConstructor {
  new (callbacks: VideoDecoderInit): DecoderLike;
}

interface WebCodecsGlobals {
  VideoDecoder?: DecoderConstructor;
  EncodedVideoChunk?: typeof EncodedVideoChunk;
}

export interface VideoViewportProps {
  readonly serial: string;
  readonly codec?: string;
}

export function VideoViewport({ serial, codec = "avc1.4D0033" }: VideoViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const decoderRef = useRef<DecoderLike | null>(null);
  const [status, setStatus] = useState<ViewportStatus>(serial ? "connecting" : "idle");
  const [statusDetail, setStatusDetail] = useState("等待设备串号");
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    decoderRef.current?.close();
    decoderRef.current = null;
    if (!serial) {
      setStatus("idle");
      setStatusDetail("请先选择主设备");
      setDimensions(null);
      return;
    }

    const globals = globalThis as typeof globalThis & WebCodecsGlobals;
    if (globals.VideoDecoder === undefined || globals.EncodedVideoChunk === undefined) {
      setStatus("unsupported");
      setStatusDetail("浏览器不支持 H.264 解码");
      return;
    }

    let cancelled = false;
    const socket = new WebSocket(buildVideoSocketUrl(serial));
    setStatus("connecting");
    setStatusDetail("正在建立主视图通道");

    const closeDecoder = () => {
      decoderRef.current?.close();
      decoderRef.current = null;
    };
    const showError = (detail: string) => {
      if (cancelled) return;
      closeDecoder();
      setStatus("error");
      setStatusDetail(detail);
    };
    const drawJpeg = async (frame: VideoFramePayload) => {
      const createBitmap = globalThis.createImageBitmap;
      if (createBitmap === undefined) {
        showError("当前浏览器无法显示降级截图");
        return;
      }
      const image = await createBitmap(new Blob([decodeBase64(frame.dataBase64)]));
      if (cancelled) {
        image.close();
        return;
      }
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (canvas === null || canvas === undefined || context === null || context === undefined) {
        image.close();
        showError("主视图画布不可用");
        return;
      }
      resizeCanvas(canvas, frame.width, frame.height);
      context.drawImage(image, 0, 0, frame.width, frame.height);
      image.close();
      setDimensions({ width: frame.width, height: frame.height });
      setStatus(frame.degraded ? "degraded" : "ready");
      setStatusDetail(frame.degraded ? "降级截图 · 输入操作已停用" : "实时主视图");
    };

    socket.onopen = () => {
      if (!cancelled) {
        setStatus("connecting");
        setStatusDetail("已连接，等待首帧");
      }
    };
    socket.onmessage = (event) => {
      let message: VideoFrameMessage;
      try {
        message = JSON.parse(String(event.data)) as VideoFrameMessage;
      } catch {
        showError("主视图消息格式无效");
        return;
      }
      if (message.type !== "video.frame" || message.frame.serial !== serial) return;
      const frame = message.frame;
      if (frame.format === "jpeg") {
        void drawJpeg(frame).catch(() => showError("降级截图解码失败"));
        return;
      }
      try {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (canvas === null || canvas === undefined || context === null || context === undefined) {
          showError("主视图画布不可用");
          return;
        }
        resizeCanvas(canvas, frame.width, frame.height);
        if (decoderRef.current === null) {
          decoderRef.current = new globals.VideoDecoder({
            output: (decoded) => {
              if (cancelled) {
                decoded.close();
                return;
              }
              context.drawImage(
                decoded as unknown as CanvasImageSource,
                0,
                0,
                frame.width,
                frame.height,
              );
              decoded.close();
              setDimensions({ width: frame.width, height: frame.height });
              setStatus(frame.degraded ? "degraded" : "ready");
              setStatusDetail(
                frame.degraded ? "降级视图" : `主视图 · ${frame.width}×${frame.height}`,
              );
            },
            error: () => showError("H.264 帧解码失败，请重试主视图"),
          });
          decoderRef.current.configure({ codec });
        }
        const timestamp = Number(frame.presentationTimestampUs ?? frame.frameId);
        const decoder = decoderRef.current;
        if (decoder === null) throw new Error("H.264 decoder is unavailable.");
        decoder.decode(
          new globals.EncodedVideoChunk({
            type: frame.keyFrame || frame.config ? "key" : "delta",
            timestamp: Number.isFinite(timestamp) ? timestamp : frame.frameId,
            data: decodeBase64(frame.dataBase64),
          }),
        );
      } catch (error) {
        showError(
          error instanceof Error
            ? `H.264 主视图初始化失败：${error.message}`
            : "H.264 主视图初始化失败，请重试",
        );
      }
    };
    socket.onerror = () => showError("主视图连接失败，请检查会话和设备状态");
    socket.onclose = () => {
      if (!cancelled && status !== "error") {
        setStatus("error");
        setStatusDetail("主视图通道已断开");
      }
    };

    return () => {
      cancelled = true;
      socket.close();
      closeDecoder();
    };
  }, [codec, retry, serial]);

  const statusText = status === "unsupported" ? "浏览器不支持 H.264 解码" : statusDetail;
  const showRetry = status === "unsupported" || status === "error";
  return (
    <section className="video-viewport" aria-label="设备主视图">
      <div className="video-viewport-heading">
        <div>
          <p className="eyebrow">LEADER VIEW / H.264</p>
          <h2>主设备画面</h2>
        </div>
        <div className={`video-status video-status-${status}`} role="status">
          {status === "connecting" && <LoaderCircle className="spin" size={14} />}
          {status === "unsupported" && <WifiOff size={14} />}
          {status === "error" && <AlertTriangle size={14} />}
          {statusText}
        </div>
      </div>
      <div className="video-stage">
        <canvas ref={canvasRef} role="img" aria-label="设备主视图" width="1" height="1" />
        {!serial && <span className="video-stage-empty">选择一台设备后连接主视图</span>}
        {showRetry && (
          <button
            className="button button-quiet video-retry"
            onClick={() => setRetry((value) => value + 1)}
          >
            <RefreshCw size={14} /> 重试主视图
          </button>
        )}
      </div>
      <div className="video-viewport-meta">
        <span>串号 · {serial || "未选择"}</span>
        <span>{dimensions ? `${dimensions.width} × ${dimensions.height}` : "等待画面"}</span>
      </div>
      {status === "error" && (
        <p className="inline-error" role="alert">
          {statusDetail}
        </p>
      )}
    </section>
  );
}

export function buildVideoSocketUrl(serial: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/video/${encodeURIComponent(serial)}`;
}

function resizeCanvas(canvas: HTMLCanvasElement, width: number, height: number): void {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  canvas.style.aspectRatio = `${width} / ${height}`;
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
