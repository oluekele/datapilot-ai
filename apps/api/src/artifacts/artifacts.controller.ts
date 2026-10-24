import {
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
  StreamableFile,
} from "@nestjs/common";
import { ApiCookieAuth, ApiProduces, ApiQuery, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { Auth, Tenant, TenantContext } from "../common/auth-context";
import { attachment, inlineImage } from "../common/http";
import { ArtifactsService } from "./artifacts.service";

@Tenant()
@ApiTags("artifacts")
@ApiCookieAuth("session")
@Controller("artifacts")
export class ArtifactsController {
  constructor(private readonly artifacts: ArtifactsService) {}

  @Get()
  @ApiQuery({ name: "kind", required: false, enum: ["CHART", "TABLE", "MODEL", "REPORT", "CODE", "DATA"] })
  list(
    @Auth() ctx: TenantContext,
    @Query("limit", new DefaultValuePipe(48), ParseIntPipe) limit: number,
    @Query("cursor") cursor?: string,
    @Query("datasetId") datasetId?: string,
    @Query("jobId") jobId?: string,
    @Query("kind") kind?: string,
    @Query("q") q?: string,
  ) {
    return this.artifacts.list(ctx, { datasetId, jobId, kind, q }, limit, cursor);
  }

  /** ZIP of chosen files (`ids=a,b,c`) or of everything matching the filters. */
  @Get("archive")
  @ApiProduces("application/zip")
  async archive(
    @Auth() ctx: TenantContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query("ids") ids?: string,
    @Query("datasetId") datasetId?: string,
    @Query("jobId") jobId?: string,
    @Query("kind") kind?: string,
    @Query("q") q?: string,
  ) {
    const idList = ids?.split(",").map((id) => id.trim()).filter(Boolean);
    const file = await this.artifacts.archive(ctx, idList, { datasetId, jobId, kind, q }, req);
    attachment(res, file.filename, "application/zip");
    return new StreamableFile(file.data);
  }

  @Get(":id/download")
  async download(
    @Auth() ctx: TenantContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.artifacts.file(ctx, id, req, "download");
    attachment(res, file.filename, file.contentType);
    return new StreamableFile(file.data);
  }

  @Get(":id/preview")
  @ApiProduces("image/png")
  async preview(
    @Auth() ctx: TenantContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.artifacts.file(ctx, id, req, "preview");
    inlineImage(res, file.contentType);
    return new StreamableFile(file.data);
  }

  @Delete(":id")
  remove(@Auth() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.artifacts.remove(ctx, id, req);
  }
}
