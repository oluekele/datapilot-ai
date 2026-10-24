import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Request } from "express";
import { PrismaService } from "../database/prisma.service";

export type AuditInput = {
  action: string;
  actorUserId?: string | null;
  organizationId?: string | null;
  subjectType?: string;
  subjectId?: string;
  metadata?: Prisma.InputJsonValue;
  req?: Request;
};

/** Append-only audit trail. Never put secrets, tokens or dataset contents in metadata. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(
    input: AuditInput,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    try {
      await tx.auditEvent.create({
        data: {
          action: input.action,
          actorUserId: input.actorUserId ?? null,
          organizationId: input.organizationId ?? null,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          metadata: input.metadata,
          ipAddress: input.req?.ip?.slice(0, 45),
          userAgent: input.req?.headers["user-agent"]?.slice(0, 500),
        },
      });
    } catch (error) {
      // Inside a transaction the caller must see the failure and roll back.
      if (tx !== this.prisma) throw error;
      this.logger.error(`Failed to record audit event ${input.action}`);
    }
  }
}
