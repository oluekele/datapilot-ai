import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async checkReadiness(): Promise<{ status: string; database: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ok", database: "ok" };
    } catch {
      throw new ServiceUnavailableException({
        status: "not_ready",
        database: "unavailable",
      });
    }
  }
}
