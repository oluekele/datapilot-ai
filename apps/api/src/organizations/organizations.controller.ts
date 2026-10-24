import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { TokenDto } from "../auth/auth.dto";
import { Auth, AuthContext, Tenant, TenantContext } from "../common/auth-context";
import { InviteDto, UpdateMemberDto, UpdateOrganizationDto } from "./organizations.dto";
import { OrganizationsService } from "./organizations.service";

@ApiTags("organization")
@ApiCookieAuth("session")
@Controller("organization")
export class OrganizationController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Tenant()
  @Get()
  get(@Auth() ctx: TenantContext) {
    return this.orgs.get(ctx);
  }

  @Tenant("OWNER", "ADMIN")
  @Patch()
  rename(@Auth() ctx: TenantContext, @Body() dto: UpdateOrganizationDto, @Req() req: Request) {
    return this.orgs.rename(ctx, dto.name, req);
  }

  @Tenant("OWNER", "ADMIN")
  @Post("invitations")
  invite(@Auth() ctx: TenantContext, @Body() dto: InviteDto, @Req() req: Request) {
    return this.orgs.invite(ctx, dto, req);
  }

  @Tenant("OWNER", "ADMIN")
  @Delete("invitations/:id")
  revoke(@Auth() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.orgs.revokeInvitation(ctx, id, req);
  }

  @Tenant("OWNER")
  @Patch("members/:userId")
  updateMember(
    @Auth() ctx: TenantContext,
    @Param("userId", ParseUUIDPipe) userId: string,
    @Body() dto: UpdateMemberDto,
    @Req() req: Request,
  ) {
    return this.orgs.updateMember(ctx, userId, dto.role, req);
  }

  @Tenant("OWNER", "ADMIN")
  @Delete("members/:userId")
  removeMember(@Auth() ctx: TenantContext, @Param("userId", ParseUUIDPipe) userId: string, @Req() req: Request) {
    return this.orgs.removeMember(ctx, userId, req);
  }
}

@ApiTags("organization")
@ApiCookieAuth("session")
@Controller("invitations")
export class InvitationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @HttpCode(200)
  @Post("accept")
  accept(@Auth() auth: AuthContext, @Body() dto: TokenDto, @Req() req: Request) {
    return this.orgs.acceptInvitation(auth, dto.token, req);
  }
}
