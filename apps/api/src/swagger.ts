import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

export const DOCS_PATH = "api/docs";

/**
 * Interactive API reference at /api/docs (JSON at /api/docs-json).
 *
 * Request/response bodies are generated from the DTO classes by the
 * @nestjs/swagger compiler plugin (see nest-cli.json), so keep validation
 * decorators on DTOs and the docs stay in sync automatically.
 */
export function setupSwagger(app: INestApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("DataPilot API")
      .setDescription(
        [
          "Multi-tenant data-quality platform API.",
          "",
          "**Authentication:** call `POST /auth/login`; the API sets an HttpOnly `dp_session` cookie",
          "that this page sends automatically. The active organisation lives in the session.",
          "",
          "**CSRF:** every non-GET request needs `X-Requested-With: datapilot`. This page adds it for you.",
          "",
          "**Admin:** `/admin/*` mutations need a super-admin account and a recent `POST /auth/step-up`.",
          "",
          "Errors are `{ statusCode, code?, message }`. See docs/api-contract.md for response shapes.",
        ].join("\n"),
      )
      .setVersion("1.0")
      .addCookieAuth("dp_session", { type: "apiKey", in: "cookie", name: "dp_session" }, "session")
      .addTag("auth", "Registration, sign-in, sessions, onboarding")
      .addTag("organization", "Members, roles and invitations of the active organisation")
      .addTag("datasets", "Uploads, versions, downloads, profiling, cleaning and analysis operations (explore, analyse, visualise, train)")
      .addTag("jobs", "Processing history")
      .addTag("artifacts", "Downloads library: charts, tables, models, reports and code produced by jobs")
      .addTag("billing", "Plans, subscriptions, Paystack checkout and webhooks")
      .addTag("admin", "Super-admin platform controls (step-up required for changes)")
      .addTag("health", "Liveness and readiness")
      .build(),
  );

  SwaggerModule.setup(DOCS_PATH, app, document, {
    customSiteTitle: "DataPilot API docs",
    swaggerOptions: {
      persistAuthorization: true,
      withCredentials: true,
      tagsSorter: "alpha",
      docExpansion: "none",
      // Satisfies the CSRF middleware for "Try it out" requests.
      requestInterceptor: (request: { headers: Record<string, string> }) => {
        request.headers["X-Requested-With"] = "datapilot";
        return request;
      },
    },
  });
}
