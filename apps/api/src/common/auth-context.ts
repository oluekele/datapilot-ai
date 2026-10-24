import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from "@nestjs/common";
import type {
  MembershipRole,
  Organization,
  Session,
  User,
} from "@prisma/client";
import type { Request } from "express";

export type AuthContext = {
  user: User;
  session: Session;
  /** Null only when the user belongs to no organisation. */
  organization: Organization | null;
  role: MembershipRole | null;
};

/** Context for routes that operate on the active organisation. */
export type TenantContext = AuthContext & {
  organization: Organization;
  role: MembershipRole;
};

export type AuthedRequest = Request & { auth?: AuthContext };

export const IS_PUBLIC = "dp:public";
export const ORG_ROLES = "dp:orgRoles";
export const SUPER_ADMIN = "dp:superAdmin";
export const STEP_UP = "dp:stepUp";
export const TENANT = "dp:tenant";

/** No session required. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Requires an active, non-suspended organisation; optionally restricts roles. */
export const Tenant = (...roles: MembershipRole[]) => SetMetadata(TENANT, roles);
export const SuperAdmin = () => SetMetadata(SUPER_ADMIN, true);
/** Requires the user to have re-entered their password recently. */
export const StepUp = () => SetMetadata(STEP_UP, true);

export const Auth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext | undefined =>
    ctx.switchToHttp().getRequest<AuthedRequest>().auth,
);
