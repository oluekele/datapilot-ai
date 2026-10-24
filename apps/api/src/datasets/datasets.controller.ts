import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiProduces, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { memoryStorage } from "multer";
import { Auth, Tenant, TenantContext } from "../common/auth-context";
import { attachment } from "../common/http";
import { OperationDto, RepairDto, UploadDto } from "./datasets.dto";
import { DatasetsService, UploadedFile as UploadedDatasetFile } from "./datasets.service";

// Absolute ceiling; per-plan limits are enforced in EntitlementsService.
const HARD_MAX_BYTES = 25 * 1024 * 1024;


@Tenant()
@ApiTags("datasets")
@ApiCookieAuth("session")
@Controller("datasets")
export class DatasetsController {
  constructor(private readonly datasets: DatasetsService) {}

  @Get()
  list(@Auth() ctx: TenantContext) {
    return this.datasets.list(ctx);
  }

  @Post()
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: {
        file: { type: "string", format: "binary", description: ".csv or .xlsx; size limit depends on plan" },
        name: { type: "string", description: "Display name (defaults to the filename)" },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: HARD_MAX_BYTES, files: 1, fields: 5 } }),
  )
  upload(
    @Auth() ctx: TenantContext,
    @UploadedFile() file: UploadedDatasetFile | undefined,
    @Body() dto: UploadDto,
    @Req() req: Request,
  ) {
    return this.datasets.upload(ctx, file, dto.name, req);
  }

  @Get(":id")
  detail(@Auth() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.datasets.detail(ctx, id);
  }

  @Delete(":id")
  remove(@Auth() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.datasets.remove(ctx, id, req);
  }

  @ApiProduces("text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
  @Get(":id/versions/:versionId/download")
  async download(
    @Auth() ctx: TenantContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("versionId", ParseUUIDPipe) versionId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.datasets.download(ctx, id, versionId, req);
    attachment(res, file.filename, file.contentType);
    return new StreamableFile(file.data);
  }

  @ApiProduces("text/markdown")
  @Get(":id/versions/:versionId/report")
  async report(
    @Auth() ctx: TenantContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("versionId", ParseUUIDPipe) versionId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.datasets.report(ctx, id, versionId);
    attachment(res, file.filename, "text/markdown; charset=utf-8");
    return new StreamableFile(file.data);
  }

  @Post(":id/versions/:versionId/profile")
  profile(
    @Auth() ctx: TenantContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("versionId", ParseUUIDPipe) versionId: string,
    @Req() req: Request,
  ) {
    return this.datasets.profile(ctx, id, versionId, req);
  }

  @Post(":id/versions/:versionId/repairs")
  repair(
    @Auth() ctx: TenantContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("versionId", ParseUUIDPipe) versionId: string,
    @Body() dto: RepairDto,
    @Req() req: Request,
  ) {
    return this.datasets.repair(ctx, id, versionId, dto, req);
  }

  @Post(":id/versions/:versionId/operations")
  operation(
    @Auth() ctx: TenantContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("versionId", ParseUUIDPipe) versionId: string,
    @Body() dto: OperationDto,
    @Req() req: Request,
  ) {
    return this.datasets.operation(ctx, id, versionId, dto, req);
  }
}
