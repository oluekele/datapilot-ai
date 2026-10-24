import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Load the repository-level .env for local development before anything reads it.
const envFile = resolve(__dirname, "../../../.env");
if (existsSync(envFile) && process.env.NODE_ENV !== "production") process.loadEnvFile(envFile);

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { csrfMiddleware, isAllowedOrigin } from "./common/csrf.middleware";
import { APP_CONFIG } from "./common/tokens";
import type { AppConfig } from "./config";
import { DOCS_PATH, setupSwagger } from "./swagger";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  const config = app.get<AppConfig>(APP_CONFIG);

  // The web app's proxy sits in front of the API; trust only loopback/private hops.
  app.set("trust proxy", "loopback, uniquelocal");
  app.setGlobalPrefix("api/v1");
  app.use(helmet());
  app.use(cookieParser());
  // The docs page calls the API from the API's own origin, so trust it while docs are on.
  const apiOrigins = config.docsEnabled ? [`http://localhost:${config.port}`, `http://127.0.0.1:${config.port}`] : [];
  app.use(csrfMiddleware([...config.webOrigins, ...apiOrigins], !config.production));
  app.enableCors({
    origin: (origin, callback) =>
      callback(null, !origin || isAllowedOrigin(origin, config.webOrigins, !config.production)),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Requested-With"],
  });
  app.useBodyParser("json", { limit: "1mb" });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  if (config.docsEnabled) setupSwagger(app);

  await app.listen(config.port, process.env.API_HOST ?? "127.0.0.1");
  if (config.docsEnabled) console.log(`API docs: http://localhost:${config.port}/${DOCS_PATH}`);
}

void bootstrap();
