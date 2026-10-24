import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { Auth, AuthContext, StepUp, SuperAdmin } from "../common/auth-context";
import { ActivateSubscriptionDto, GrantTrialDto, ReasonDto, UpdatePlanDto } from "./admin.dto";
import { AdminService } from "./admin.service";

@SuperAdmin()
@ApiTags("admin")
@ApiCookieAuth("session")
@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("overview")
  overview() {
    return this.admin.overview();
  }

  @Get("organizations")
  organizations(@Query("q") q?: string, @Query("status") status?: string) {
    return this.admin.organizations(q, status);
  }

  @Get("organizations/:id")
  organization(@Param("id", ParseUUIDPipe) id: string) {
    return this.admin.organization(id);
  }

  @StepUp()
  @HttpCode(200)
  @Post("organizations/:id/suspend")
  suspend(@Auth() a: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @Req() req: Request) {
    return this.admin.setOrganizationStatus(a, id, "SUSPENDED", dto.reason, req);
  }

  @StepUp()
  @HttpCode(200)
  @Post("organizations/:id/reactivate")
  reactivate(@Auth() a: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @Req() req: Request) {
    return this.admin.setOrganizationStatus(a, id, "ACTIVE", dto.reason, req);
  }

  @StepUp()
  @HttpCode(200)
  @Post("organizations/:id/trial")
  grantTrial(@Auth() a: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body() dto: GrantTrialDto, @Req() req: Request) {
    return this.admin.grantTrial(a, id, dto.days, dto.reason, req);
  }

  @StepUp()
  @HttpCode(200)
  @Post("organizations/:id/trial/end")
  endTrial(@Auth() a: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @Req() req: Request) {
    return this.admin.endTrial(a, id, dto.reason, req);
  }

  @StepUp()
  @HttpCode(200)
  @Post("organizations/:id/subscription")
  activate(@Auth() a: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ActivateSubscriptionDto, @Req() req: Request) {
    return this.admin.activateSubscription(a, id, dto, req);
  }

  @StepUp()
  @HttpCode(200)
  @Post("organizations/:id/subscription/cancel")
  cancelSubscription(@Auth() a: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @Req() req: Request) {
    return this.admin.cancelSubscription(a, id, dto.reason, req);
  }

  @Get("users")
  users(@Query("q") q?: string) {
    return this.admin.users(q);
  }

  @StepUp()
  @HttpCode(200)
  @Post("users/:id/suspend")
  suspendUser(@Auth() a: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @Req() req: Request) {
    return this.admin.setUserStatus(a, id, true, dto.reason, req);
  }

  @StepUp()
  @HttpCode(200)
  @Post("users/:id/reactivate")
  reactivateUser(@Auth() a: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @Req() req: Request) {
    return this.admin.setUserStatus(a, id, false, dto.reason, req);
  }

  @Get("jobs")
  jobs(@Query("status") status?: string) {
    return this.admin.jobs(status);
  }

  @Get("audit")
  audit(@Query("action") action?: string, @Query("organizationId") organizationId?: string) {
    return this.admin.auditLog(action, organizationId);
  }

  @Get("plans")
  plans() {
    return this.admin.plans();
  }

  @StepUp()
  @Patch("plans/:code")
  updatePlan(@Auth() a: AuthContext, @Param("code") code: string, @Body() dto: UpdatePlanDto, @Req() req: Request) {
    return this.admin.updatePlan(a, code, dto, req);
  }
}
