import { HttpException } from "@nestjs/common";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "EMAIL_NOT_VERIFIED"
  | "ACCOUNT_LOCKED"
  | "ACCOUNT_SUSPENDED"
  | "ORG_SUSPENDED"
  | "NO_ORGANIZATION"
  | "SUBSCRIPTION_REQUIRED"
  | "PLAN_LIMIT"
  | "FORBIDDEN_ROLE"
  | "FORBIDDEN"
  | "STEP_UP_REQUIRED"
  | "TRIAL_ALREADY_USED"
  | "INVALID_TOKEN"
  | "CONFLICT"
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "PAYMENTS_DISABLED"
  | "CSRF";

/** An expected error whose message is safe to show to the user. */
export class AppError extends HttpException {
  constructor(status: number, code: ErrorCode, message: string) {
    super({ statusCode: status, code, message }, status);
  }
}

export const notFound = (what = "Resource"): AppError =>
  new AppError(404, "NOT_FOUND", `${what} not found.`);
