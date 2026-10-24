import { Module } from "@nestjs/common";
import { JobRunnerService } from "../jobs/job-runner.service";
import { JobsController } from "../jobs/jobs.controller";
import { DatasetsController } from "./datasets.controller";
import { DatasetsService } from "./datasets.service";

@Module({
  controllers: [DatasetsController, JobsController],
  providers: [DatasetsService, JobRunnerService],
})
export class DatasetsModule {}
