import { Body, Controller, Get, Headers, HttpCode, Post, RawBodyRequest, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { IsString, Length } from "class-validator";
import type { Request } from "express";
import { Auth, Public, Tenant, TenantContext } from "../common/auth-context";
import { BillingService } from "./billing.service";

class CheckoutDto {
  @IsString()
  @Length(1, 40)
  planCode!: string;
}

class VerifyDto {
  @IsString()
  @Length(1, 120)
  reference!: string;
}

@ApiTags("billing")
@ApiCookieAuth("session")
@Controller("billing")
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Public()
  @Get("plans")
  plans() {
    return this.billing.plans();
  }

  /** Public trial policy, for sign-up and pricing copy. */
  @Public()
  @Get("trial")
  trial() {
    return this.billing.trialPolicy();
  }

  @Tenant()
  @Get()
  overview(@Auth() ctx: TenantContext) {
    return this.billing.overview(ctx);
  }

  @Tenant("OWNER", "ADMIN")
  @HttpCode(200)
  @Post("checkout")
  checkout(@Auth() ctx: TenantContext, @Body() dto: CheckoutDto, @Req() req: Request) {
    return this.billing.checkout(ctx, dto.planCode, req);
  }

  @Tenant()
  @HttpCode(200)
  @Post("verify")
  verify(@Auth() ctx: TenantContext, @Body() dto: VerifyDto) {
    return this.billing.verify(ctx, dto.reference);
  }

  @Tenant("OWNER", "ADMIN")
  @HttpCode(200)
  @Post("cancel")
  cancel(@Auth() ctx: TenantContext, @Req() req: Request) {
    return this.billing.cancel(ctx, req);
  }

  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @Post("webhooks/paystack")
  async paystackWebhook(@Req() req: RawBodyRequest<Request>, @Headers("x-paystack-signature") signature?: string) {
    await this.billing.handleWebhook(req.rawBody, signature);
    return { ok: true };
  }
}
