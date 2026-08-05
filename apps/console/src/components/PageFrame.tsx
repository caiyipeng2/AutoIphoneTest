import type { ReactNode } from "react";

export function PageFrame({
  title,
  eyebrow,
  action,
  children,
}: {
  title: string;
  eyebrow: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="page-frame" aria-labelledby="page-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1 id="page-title">{title}</h1>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Metric({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: string;
}) {
  return (
    <div className={`metric metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

export function DataRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="data-row">
      <span>{label}</span>
      <strong className={tone ? `text-${tone}` : undefined}>{value}</strong>
    </div>
  );
}
