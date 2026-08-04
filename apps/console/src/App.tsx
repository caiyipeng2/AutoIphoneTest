import { useEffect, useMemo, useState } from "react";
import { Bell, CircleHelp, ExternalLink, Menu, Radio, X } from "lucide-react";
import {
  fetchHealth,
  fetchSettings,
  exchangeBootstrapCode,
  type HealthSnapshot,
  type SettingsSnapshot,
} from "./state/api";
import { NAV_ITEMS, readRoute } from "./state/navigation";
import { openStateStream } from "./state/stream";
import { StatusBanner } from "./components/StatusBanner";
import { OverviewPage } from "./pages/OverviewPage";
import { DevicesPage } from "./pages/DevicesPage";
import { AppsPage } from "./pages/AppsPage";
import { DeploymentsPage } from "./pages/DeploymentsPage";
import { SessionsPage } from "./pages/SessionsPage";
import { ResultsPage } from "./pages/ResultsPage";
import { SettingsPage } from "./pages/SettingsPage";
import "./styles.css";

export function App() {
  const [route, setRoute] = useState(readRoute());
  const [navOpen, setNavOpen] = useState(false);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [settings, setSettings] = useState<SettingsSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [deviceRefreshKey, setDeviceRefreshKey] = useState(0);

  useEffect(() => {
    const onHash = () => {
      setRoute(readRoute());
      setNavOpen(false);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const code = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("code");
      if (code) {
        await exchangeBootstrapCode(code).catch(() => undefined);
        window.history.replaceState(null, "", window.location.pathname + "#overview");
      }
      const [healthResult, settingsResult] = await Promise.allSettled([
        fetchHealth(),
        fetchSettings(),
      ]);
      if (cancelled) return;
      if (healthResult.status === "fulfilled") setHealth(healthResult.value);
      if (settingsResult.status === "fulfilled") setSettings(settingsResult.value);
    };
    void load();
    const timer = window.setInterval(() => {
      void fetchHealth()
        .then((value) => {
          if (!cancelled) setHealth(value);
        })
        .catch(() => undefined);
    }, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!health) return;
    const socket = openStateStream((event) => {
      if (event.snapshot) setHealth(event.snapshot);
      if (event.device || event.devices) setDeviceRefreshKey((value) => value + 1);
    }, setConnected);
    return () => socket.close();
  }, [health !== null]);

  const activeItem = useMemo(
    () => NAV_ITEMS.find((item) => item.key === route) ?? NAV_ITEMS[0]!,
    [route],
  );
  const page =
    route === "devices" ? (
      <DevicesPage refreshKey={deviceRefreshKey} />
    ) : route === "apps" ? (
      <AppsPage />
    ) : route === "deployments" ? (
      <DeploymentsPage />
    ) : route === "sessions" ? (
      <SessionsPage />
    ) : route === "results" ? (
      <ResultsPage />
    ) : route === "settings" ? (
      <SettingsPage settings={settings} onSave={() => undefined} />
    ) : (
      <OverviewPage
        health={health}
        onRefresh={() =>
          void fetchHealth()
            .then(setHealth)
            .catch(() => undefined)
        }
      />
    );

  return (
    <div className="app-shell">
      <aside className={`sidebar ${navOpen ? "is-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">TC</span>
          <div>
            <strong>Test Center</strong>
            <small>UNITY / ANDROID</small>
          </div>
          <button
            className="icon-button close-nav"
            title="关闭导航"
            aria-label="关闭导航"
            onClick={() => setNavOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="sidebar-rule" />
        <nav aria-label="主导航">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.key}
                href={`#${item.key}`}
                aria-label={item.label}
                aria-current={item.key === route ? "page" : undefined}
              >
                <Icon size={17} />
                <span>{item.label}</span>
                {item.key === "devices" && <em aria-hidden="true">1</em>}
              </a>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="operator-dot">
            <span />
            本地控制台
          </div>
          <small>数据根目录 · E:\TestCenterData</small>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <button
            className="icon-button menu-button"
            title="打开导航"
            aria-label="打开导航"
            onClick={() => setNavOpen(true)}
          >
            <Menu size={19} />
          </button>
          <div className="crumb">
            <span>TEST BAY</span>
            <b>/</b>
            <strong>{activeItem.label}</strong>
          </div>
          <div className="top-actions">
            <span className="connection">
              <Radio size={15} />
              {connected ? "实时" : "轮询"}
            </span>
            <button className="icon-button" title="通知" aria-label="通知">
              <Bell size={17} />
            </button>
            <button className="icon-button" title="帮助" aria-label="帮助">
              <CircleHelp size={17} />
            </button>
            <a className="external-link" href="#settings" aria-label="打开设置">
              <ExternalLink size={15} />
            </a>
          </div>
        </header>
        <StatusBanner health={health} connected={connected} />
        <main>{page}</main>
        <footer className="footer">
          <span>Test Center · local only</span>
          <span>UID 驱动账号 · 证据默认 HTML + ZIP</span>
        </footer>
      </div>
    </div>
  );
}
