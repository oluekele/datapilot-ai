import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { MembershipRole } from "@prisma/client";
import {
  AuthedRequest,
  IS_PUBLIC,
  STEP_UP,
  SUPER_ADMIN,
  TENANT,
} from "../common/auth-context";
import { AppError } from "../common/errors";
import { SessionService } from "./session.service";

/**
 * Global guard. Every route requires a valid session unless marked @Public().
 * Tenant routes additionally require an active membership in an active
 * organisation, re-checked against the database on every request.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);

    const auth = await this.sessions.resolve(req);
    if (auth) req.auth = auth;
    if (isPublic) return true;
    if (!auth) throw new AppError(401, "UNAUTHENTICATED", "Please sign in.");

    if (this.reflector.getAllAndOverride<boolean>(SUPER_ADMIN, targets)) {
      if (auth.user.platformRole !== "SUPER_ADMIN") {
        throw new AppError(403, "FORBIDDEN", "Platform administrators only.");
      }
    }

    if (
      this.reflector.getAllAndOverride<boolean>(STEP_UP, targets) &&
      !this.sessions.hasRecentStepUp(auth.session)
    ) {
      throw new AppError(
        403,
        "STEP_UP_REQUIRED",
        "Confirm your password to continue.",
      );
    }

    const tenantRoles = this.reflector.getAllAndOverride<MembershipRole[] | undefined>(
      TENANT,
      targets,
    );
    if (tenantRoles) {
      if (!auth.organization || !auth.role) {
        throw new AppError(403, "NO_ORGANIZATION", "You are not a member of any organisation.");
      }
      if (auth.organization.status === "SUSPENDED") {
        throw new AppError(
          403,
          "ORG_SUSPENDED",
          "This organisation is suspended. Contact DataPilot support.",
        );
      }
      if (tenantRoles.length && !tenantRoles.includes(auth.role)) {
        throw new AppError(
          403,
          "FORBIDDEN_ROLE",
          "Your role in this organisation does not allow this action.",
        );
      }
    }
    return true;
  }
}
