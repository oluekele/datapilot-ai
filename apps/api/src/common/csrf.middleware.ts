import type { NextFunction, Request, Response } from "express";
import { AppError } from "./errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/** True if `origin` may make state-changing requests. */
export function isAllowedOrigin(origin: string, allowedOrigins: string[], allowAnyLocalhost: boolean): boolean {
  return allowedOrigins.includes(origin) || (allowAnyLocalhost && LOCAL_ORIGIN.test(origin));
}

/**
 * Cookie-authenticated APIs need CSRF protection. A custom header cannot be
 * sent cross-site without a CORS preflight (which our allow-list rejects), and
 * the Origin check covers browsers that send one. Webhooks are authenticated
 * by signature instead.
 *
 * In development any localhost port is accepted, so the web app's dev port can
 * change without breaking sign-in. Production requires an exact WEB_ORIGIN match.
 */
export function csrfMiddleware(allowedOrigins: string[], allowAnyLocalhost: boolean) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(req.method) || req.path.includes("/billing/webhooks/")) {
      return next();
    }
    const origin = req.headers.origin;
    if (req.headers["x-requested-with"] !== "datapilot") {
      return next(new AppError(403, "CSRF", "Missing request header."));
    }
    if (origin && !isAllowedOrigin(origin, allowedOrigins, allowAnyLocalhost)) {
      return next(new AppError(403, "CSRF", "Cross-origin request rejected."));
    }
    next();
  };
}
