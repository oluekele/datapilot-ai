import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "../common/auth-context";
import { HealthService } from "./health.service";

@Public()
@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get("live")
  live(): { status: string } {
    return { status: "ok" };
  }

  @Get("ready")
  ready(): Promise<{ status: string; database: string }> {
    return this.healthService.checkReadiness();
  }
}
