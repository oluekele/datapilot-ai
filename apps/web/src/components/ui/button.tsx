import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "dark" | "light" | "danger" | "ghost";
type Size = "default" | "small";

function classes(variant: ButtonVariant, size: Size, extra?: string): string {
  return ["button", `button-${variant}`, size === "small" ? "button-small" : "", extra ?? ""].filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: Size;
  loading?: boolean;
};

export function Button({ variant = "dark", size = "default", loading = false, className, disabled, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={classes(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  variant?: ButtonVariant;
  size?: Size;
  children: ReactNode;
  /** Use a plain anchor (downloads, API routes) instead of client-side navigation. */
  external?: boolean;
};

export function ButtonLink({ href, variant = "dark", size = "default", className, external, children, ...rest }: ButtonLinkProps) {
  const cls = classes(variant, size, className);
  if (external) {
    return <a {...rest} href={href} className={cls}>{children}</a>;
  }
  return <Link {...rest} href={href} className={cls}>{children}</Link>;
}
