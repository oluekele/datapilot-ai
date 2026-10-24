import { Controller, DefaultValuePipe, Get, Param, ParseIntPipe, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { Auth, Tenant, TenantContext } from "../common/auth-context";
import { notFound } from "../common/errors";
import { PrismaService } from "../database/prisma.service";
import { creatorSelect, serializeJob } from "../datasets/serializers";

@Tenant()
@ApiTags("jobs")
@ApiCookieAuth("session")
@Controller("jobs")
export class JobsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Auth() ctx: TenantContext, @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    const jobs = await this.prisma.processingJob.findMany({
      where: { organizationId: ctx.organization.id },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
      include: { createdBy: creatorSelect, dataset: { select: { name: true } } },
    });
    return jobs.map((j) => serializeJob(j));
  }

  @Get(":id")
  async get(@Auth() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string) {
    const job = await this.prisma.processingJob.findFirst({
      where: { id, organizationId: ctx.organization.id },
      include: { createdBy: creatorSelect, dataset: { select: { name: true } } },
    });
    if (!job) throw notFound("Job");
    return serializeJob(job);
  }
}
