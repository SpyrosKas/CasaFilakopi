import { randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import Stripe from "stripe";

// A local stand-in for the parts of Stripe's API this site calls, reached
// through the real SDK with its `host` and `port` options. It copies the rules
// that matter here: a Session lives at least 30 minutes, a repeated idempotency
// key replays the first answer and refuses different parameters, a paid Session
// cannot be expired, and a payment cannot be refunded past its amount.
//
// It is a test double. Passing against it says nothing about real Stripe.

export const FAKE_SECRET_KEY = "sk_test_fake_key";
export const FAKE_PUBLISHABLE_KEY = "pk_test_fake_key";
export const FAKE_WEBHOOK_SECRET = "whsec_fake_webhook_secret";

const MIN_SESSION_SECONDS = 30 * 60;

type Json = Record<string, unknown>;

export interface FakeSession extends Json {
  id: string;
  object: "checkout.session";
  status: "open" | "complete" | "expired";
  payment_status: "unpaid" | "paid";
  amount_total: number;
  currency: string;
  url: string | null;
  metadata: Record<string, string>;
  payment_intent: string | null;
  client_reference_id: string | null;
  customer_email: string | null;
  expires_at: number;
  success_url: string;
  cancel_url: string;
}

export interface FakeRefund extends Json {
  id: string;
  object: "refund";
  amount: number;
  status: string;
  payment_intent: string;
  metadata: Record<string, string>;
}

interface Failure {
  status: number;
  type: string;
  message: string;
}

const isFailure = (value: object): value is Failure =>
  typeof (value as { status?: unknown }).status === "number";

const id = (prefix: string) => `${prefix}_${randomBytes(12).toString("hex")}`;

/** Stripe's form encoding, a[b][0][c]=1, back into an object. */
function parseForm(body: string): Json {
  const root: Json = {};
  for (const [rawKey, value] of new URLSearchParams(body)) {
    const path = rawKey.replace(/\]/g, "").split("[");
    let node: Record<string, unknown> = root;
    path.forEach((part, index) => {
      if (index === path.length - 1) node[part] = value;
      else node = (node[part] ??= {}) as Record<string, unknown>;
    });
  }
  return root;
}

const readBody = (request: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let text = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (text += chunk));
    request.on("end", () => resolve(text));
  });

export interface FakeStripeOptions {
  /** The webhook route, for the hosted page's Pay button. */
  webhookUrl?: string;
  /** Replaces the hosted page's address for an in-process test. */
  port?: number;
}

export class FakeStripe {
  readonly sessions = new Map<string, FakeSession>();
  readonly refunds = new Map<string, FakeRefund>();
  /** Every create, with the idempotency key it arrived with. */
  readonly creates: { key: string | undefined; params: Json }[] = [];
  readonly refundKeys: (string | undefined)[] = [];
  private readonly idempotent = new Map<
    string,
    { params: string; status: number; body: unknown }
  >();
  private readonly intents = new Map<string, Json>();
  private readonly failures = new Map<string, Failure[]>();
  private server!: Server;
  private eventCount = 0;
  port = 0;
  /** Runs before a create answers, to land a webhook ahead of attach. */
  onSessionCreated?: (session: FakeSession) => Promise<void>;
  /** Stripe's own helpers. No request is made with this key. */
  readonly sdk = new Stripe(FAKE_SECRET_KEY);

  constructor(private readonly options: FakeStripeOptions = {}) {}

  async start(): Promise<this> {
    this.server = createServer((request, response) => {
      this.route(request, response).catch((error: unknown) => {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: String(error) } }));
      });
    });
    await new Promise<void>((resolve) =>
      this.server.listen(this.options.port ?? 0, "127.0.0.1", resolve),
    );
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  async stop() {
    this.server.closeAllConnections();
    await new Promise((resolve) => this.server.close(resolve));
  }

  /** A real SDK client pointed here. */
  client(): Stripe {
    return new Stripe(FAKE_SECRET_KEY, {
      host: "127.0.0.1",
      port: this.port,
      protocol: "http",
      maxNetworkRetries: 1,
      telemetry: false,
    });
  }

  /** The next calls to an operation answer with this error. */
  failNext(
    operation: "session" | "refund" | "expire",
    failure: Partial<Failure> = {},
    times = 1,
  ) {
    const entry: Failure = {
      status: 402,
      type: "invalid_request_error",
      message: "Refused by the fake",
      ...failure,
    };
    this.failures.set(
      operation,
      Array.from({ length: times }, () => entry),
    );
  }

  private takeFailure(operation: string): Failure | undefined {
    return this.failures.get(operation)?.shift();
  }

  /** What Stripe does when a guest finishes paying. */
  pay(
    sessionId: string,
    {
      amount,
      status = "paid",
    }: { amount?: number; status?: "paid" | "unpaid" } = {},
  ): FakeSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`no session ${sessionId}`);
    const intent = id("pi");
    session.status = "complete";
    session.payment_status = status;
    session.payment_intent = intent;
    if (amount !== undefined) session.amount_total = amount;
    this.intents.set(intent, {
      id: intent,
      object: "payment_intent",
      amount: session.amount_total,
      metadata: session.metadata,
    });
    return session;
  }

  clearIntentMetadata(intent: string) {
    const found = this.intents.get(intent);
    if (found) found.metadata = {};
  }

  /** Stripe keeps idempotency keys for at least 24 hours, then forgets them. */
  forgetIdempotencyKeys() {
    this.idempotent.clear();
  }

  /** A refund made by hand in the Stripe dashboard. */
  dashboardRefund(intent: string, amount: number, status = "succeeded") {
    const refund: FakeRefund = {
      id: id("re"),
      object: "refund",
      amount,
      status,
      payment_intent: intent,
      metadata: {},
    };
    this.refunds.set(refund.id, refund);
    return refund;
  }

  /** A signed event, as Stripe would POST it. */
  event(type: string, object: unknown, eventId?: string) {
    this.eventCount += 1;
    const payload = JSON.stringify({
      id: eventId ?? id("evt"),
      object: "event",
      api_version: Stripe.API_VERSION,
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type,
      data: { object },
    });
    return { payload, signature: this.sign(payload) };
  }

  sign(payload: string, secret = FAKE_WEBHOOK_SECRET) {
    return this.sdk.webhooks.generateTestHeaderString({ payload, secret });
  }

  get openSessions() {
    return [...this.sessions.values()].filter((s) => s.status === "open");
  }

  private async route(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${this.port}`);
    const { pathname } = url;
    const body = await readBody(request);
    const send = (status: number, value: unknown) => {
      response.writeHead(status, {
        "content-type": "application/json",
        "request-id": id("req"),
      });
      response.end(JSON.stringify(value));
    };
    const refuse = ({ status, type, message }: Failure) =>
      send(status, { error: { type, message } });

    if (pathname === "/__fail/refund") {
      this.failNext("refund");
      return send(200, { ok: true });
    }

    if (pathname.startsWith("/pay/")) {
      return this.hostedPage(pathname, request, response);
    }

    if (request.method === "POST" && pathname === "/v1/checkout/sessions") {
      const replay = this.replay(request, body, send);
      if (replay) return;
      const failure = this.takeFailure("session");
      if (failure) return refuse(failure);
      const result = this.createSession(parseForm(body), request);
      if (isFailure(result)) return refuse(result);
      if (this.onSessionCreated) await this.onSessionCreated(result);
      this.remember(request, body, 200, result);
      return send(200, result);
    }

    const session = pathname.match(/^\/v1\/checkout\/sessions\/([^/]+)$/);
    if (request.method === "GET" && session) {
      const found = this.sessions.get(session[1]);
      return found
        ? send(200, found)
        : refuse({
            status: 404,
            type: "invalid_request_error",
            message: "No such session",
          });
    }

    const expire = pathname.match(
      /^\/v1\/checkout\/sessions\/([^/]+)\/expire$/,
    );
    if (request.method === "POST" && expire) {
      const failure = this.takeFailure("expire");
      if (failure) return refuse(failure);
      const found = this.sessions.get(expire[1]);
      if (!found || found.status !== "open") {
        return refuse({
          status: 400,
          type: "invalid_request_error",
          message: "Only open sessions can be expired",
        });
      }
      found.status = "expired";
      found.url = null;
      return send(200, found);
    }

    if (request.method === "POST" && pathname === "/v1/refunds") {
      const key = request.headers["idempotency-key"] as string | undefined;
      this.refundKeys.push(key);
      const replay = this.replay(request, body, send);
      if (replay) return;
      const failure = this.takeFailure("refund");
      if (failure) {
        this.remember(request, body, failure.status, {
          error: { type: failure.type, message: failure.message },
        });
        return refuse(failure);
      }
      const result = this.createRefund(parseForm(body));
      if (isFailure(result)) return refuse(result);
      this.remember(request, body, 200, result);
      return send(200, result);
    }

    if (request.method === "GET" && pathname === "/v1/refunds") {
      const intent = url.searchParams.get("payment_intent");
      return send(200, {
        object: "list",
        url: "/v1/refunds",
        has_more: false,
        data: [...this.refunds.values()].filter(
          (refund) => refund.payment_intent === intent,
        ),
      });
    }

    const intent = pathname.match(/^\/v1\/payment_intents\/([^/]+)$/);
    if (request.method === "GET" && intent) {
      const found = this.intents.get(intent[1]);
      return found
        ? send(200, found)
        : refuse({
            status: 404,
            type: "invalid_request_error",
            message: "No such intent",
          });
    }

    return refuse({
      status: 404,
      type: "invalid_request_error",
      message: `Not faked: ${request.method} ${pathname}`,
    });
  }

  private replay(
    request: IncomingMessage,
    body: string,
    send: (status: number, value: unknown) => void,
  ): boolean {
    const key = request.headers["idempotency-key"] as string | undefined;
    const earlier = key ? this.idempotent.get(key) : undefined;
    if (!earlier) return false;
    if (earlier.params !== body) {
      send(400, {
        error: {
          type: "idempotency_error",
          message: "Keys can only be used with the same parameters",
        },
      });
    } else {
      send(earlier.status, earlier.body);
    }
    return true;
  }

  private remember(
    request: IncomingMessage,
    body: string,
    status: number,
    value: unknown,
  ) {
    const key = request.headers["idempotency-key"] as string | undefined;
    if (key) this.idempotent.set(key, { params: body, status, body: value });
  }

  private createSession(
    params: Json,
    request: IncomingMessage,
  ): FakeSession | Failure {
    const expiresAt = Number(params.expires_at);
    if (expiresAt < Math.floor(Date.now() / 1000) + MIN_SESSION_SECONDS) {
      return {
        status: 400,
        type: "invalid_request_error",
        message: "expires_at must be at least 30 minutes from now",
      };
    }
    this.creates.push({
      key: request.headers["idempotency-key"] as string | undefined,
      params,
    });

    const item = (params.line_items as Record<string, Json>)["0"];
    const price = item.price_data as Json;
    const sessionId = `cs_test_${randomBytes(16).toString("hex")}`;
    const session: FakeSession = {
      id: sessionId,
      object: "checkout.session",
      status: "open",
      payment_status: "unpaid",
      amount_total: Number(price.unit_amount) * Number(item.quantity),
      currency: String(price.currency),
      url: `http://127.0.0.1:${this.port}/pay/${sessionId}`,
      metadata: (params.metadata ?? {}) as Record<string, string>,
      payment_intent: null,
      client_reference_id: (params.client_reference_id as string) ?? null,
      customer_email: (params.customer_email as string) ?? null,
      expires_at: expiresAt,
      success_url: String(params.success_url),
      cancel_url: String(params.cancel_url),
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  private createRefund(params: Json): FakeRefund | Failure {
    const intent = String(params.payment_intent);
    const paid = Number(this.intents.get(intent)?.amount ?? 0);
    const used = [...this.refunds.values()]
      .filter((r) => r.payment_intent === intent && r.status !== "failed")
      .reduce((total, r) => total + r.amount, 0);
    const amount = Number(params.amount);
    if (used + amount > paid) {
      return {
        status: 400,
        type: "invalid_request_error",
        message: "Refund is greater than the unrefunded amount",
      };
    }
    const refund: FakeRefund = {
      id: id("re"),
      object: "refund",
      amount,
      status: this.refundStatus,
      payment_intent: intent,
      metadata: (params.metadata ?? {}) as Record<string, string>,
    };
    this.refunds.set(refund.id, refund);
    return refund;
  }

  /** What a new refund reports. Some methods answer `pending` first. */
  refundStatus = "succeeded";

  /** Stands in for Stripe's hosted payment page, for browser tests. */
  private async hostedPage(
    pathname: string,
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    const [, , sessionId, action] = pathname.split("/");
    const session = this.sessions.get(sessionId);
    if (!session) {
      response.writeHead(404);
      response.end("no session");
      return;
    }

    if (action === "cancel") {
      response.writeHead(303, { location: session.cancel_url });
      response.end();
      return;
    }

    if (action === "pay" && request.method === "POST") {
      this.pay(sessionId);
      const { payload, signature } = this.event(
        "checkout.session.completed",
        session,
      );
      // Late on purpose: the return page must show its waiting state first.
      setTimeout(() => {
        void fetch(this.options.webhookUrl!, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "stripe-signature": signature,
          },
          body: payload,
        });
      }, 1500);
      response.writeHead(303, {
        location: session.success_url.replace(
          "{CHECKOUT_SESSION_ID}",
          sessionId,
        ),
      });
      response.end();
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><title>Fake Stripe</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <h1>Fake Stripe hosted page</h1>
      <p data-testid="amount">${session.amount_total}</p>
      <form method="post" action="/pay/${sessionId}/pay">
        <button type="submit">Pay</button>
      </form>
      <a href="/pay/${sessionId}/cancel">Back to the site</a>`);
  }
}
