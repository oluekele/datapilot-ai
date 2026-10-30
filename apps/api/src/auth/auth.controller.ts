import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { Auth, AuthContext, Public } from "../common/auth-context";
import {
  EmailDto,
  LoginDto,
  PasswordDto,
  RegisterDto,
  ResetPasswordDto,
  SwitchOrganizationDto,
} from "./auth.dto";
import { AuthService } from "./auth.service";

// Credential endpoints get a much tighter rate limit than the global one.
const STRICT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags("auth")
@ApiCookieAuth("session")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(STRICT)
  @Post("register")
  register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.register(dto, req, res);
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(200)
  @Post("login")
  login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(dto, req, res);
  }

  @Public()
  @HttpCode(200)
  @Post("logout")
  logout(@Auth() auth: AuthContext | undefined, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.logout(auth, req, res);
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(200)
  @Post("forgot-password")
  forgot(@Body() dto: EmailDto, @Req() req: Request) {
    return this.auth.forgotPassword(dto.email, req);
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(200)
  @Post("reset-password")
  reset(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.auth.resetPassword(dto.token, dto.password, req);
  }

  @Get("me")
  me(@Auth() auth: AuthContext) {
    return this.auth.me(auth.user.id, auth.session);
  }

  @HttpCode(200)
  @Post("onboarding/complete")
  completeOnboarding(@Auth() auth: AuthContext) {
    return this.auth.completeOnboarding(auth);
  }

  @HttpCode(200)
  @Post("switch-organization")
  switchOrganization(@Auth() auth: AuthContext, @Body() dto: SwitchOrganizationDto) {
    return this.auth.switchOrganization(auth, dto.organizationId);
  }

  @Throttle(STRICT)
  @HttpCode(200)
  @Post("step-up")
  stepUp(@Auth() auth: AuthContext, @Body() dto: PasswordDto, @Req() req: Request) {
    return this.auth.stepUp(auth, dto.password, req);
  }
}
