import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, emphasis, children, actions }: {
  eyebrow: string;
  title: string;
  emphasis?: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title} {emphasis && <em>{emphasis}</em>}</h1>
        {children && <p className="page-lede">{children}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return <div className="loading-block" role="status"><span className="spinner" aria-hidden="true" /> {label}</div>;
}
