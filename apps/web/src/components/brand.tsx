import Link from "next/link";

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link className="brand" href={href} aria-label="DataPilot home">
      <span className="brand-mark" aria-hidden="true">D</span>
      <span>datapilot<span className="brand-dot">.</span></span>
    </Link>
  );
}
