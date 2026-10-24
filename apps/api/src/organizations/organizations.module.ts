import { Module } from "@nestjs/common";
import { InvitationsController, OrganizationController } from "./organizations.controller";
import { OrganizationsService } from "./organizations.service";

@Module({
  controllers: [OrganizationController, InvitationsController],
  providers: [OrganizationsService],
})
export class OrganizationsModule {}
