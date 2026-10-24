import { Global, Module } from "@nestjs/common";
import { loadConfig } from "../config";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { MailService } from "../mail/mail.service";
import { StorageService } from "../storage/storage.service";
import { AuditService } from "./audit.service";
import { APP_CONFIG } from "./tokens";

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: loadConfig },
    AuditService,
    MailService,
    StorageService,
    EntitlementsService,
  ],
  exports: [APP_CONFIG, AuditService, MailService, StorageService, EntitlementsService],
})
export class CoreModule {}
