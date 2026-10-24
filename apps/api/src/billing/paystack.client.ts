import { createHmac } from "node:crypto";
import { safeEqual } from "../common/crypto";

const BASE_URL = "https://api.paystack.co";

export type PaystackTransaction = {
  id: number;
  status: string;
  reference: string;
  amount: number;
  currency: string;
  paid_at?: string | null;
  metadata?: unknown;
  customer?: { customer_code?: string; email?: string };
  plan?: string | { plan_code?: string } | null;
};

/** Minimal Paystack REST client. The secret key never leaves the server. */
export class PaystackClient {
  constructor(private readonly secretKey: string) {}

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await response.json().catch(() => null)) as { status?: boolean; message?: string; data?: T } | null;
    if (!response.ok || !json?.status) {
      throw new Error(`Paystack ${path} failed: ${json?.message ?? response.status}`);
    }
    return json.data as T;
  }

  initialize(input: {
    email: string;
    amount: number;
    reference: string;
    callbackUrl: string;
    plan?: string | null;
    metadata: Record<string, string>;
  }) {
    return this.request<{ authorization_url: string; reference: string }>("POST", "/transaction/initialize", {
      email: input.email,
      amount: input.amount,
      reference: input.reference,
      callback_url: input.callbackUrl,
      // With a plan code Paystack creates a recurring subscription after the first charge.
      ...(input.plan ? { plan: input.plan } : {}),
      metadata: input.metadata,
    });
  }

  verify(reference: string) {
    return this.request<PaystackTransaction>("GET", `/transaction/verify/${encodeURIComponent(reference)}`);
  }

  disableSubscription(code: string, token: string) {
    return this.request<unknown>("POST", "/subscription/disable", { code, token });
  }

  /** Paystack signs the raw body with HMAC-SHA512 using the secret key. */
  verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected = createHmac("sha512", this.secretKey).update(rawBody).digest("hex");
    return safeEqual(expected, signature);
  }
}
