import { DurableObject } from "cloudflare:workers";
import { handleOrderAPI } from "./order-api.js";
import { emptyLedger, reserveTrial, finishTrial } from "./trial-ledger.js";

export class TrialLedger extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.inflight = 0;
  }
  async fetch(request) {
    const interpretation =
      request.method === "POST" &&
      new URL(request.url).pathname === "/api/order-checker/interpret";
    if (interpretation && this.inflight >= 2)
      return Response.json(
        {
          error:
            "Other document pairs are currently being interpreted. Please wait and try again; this request has not used your free attempt.",
          code: "service_busy",
        },
        {
          status: 429,
          headers: { "Cache-Control": "no-store", "Retry-After": "30" },
        },
      );
    if (interpretation) this.inflight++;
    const store = this.ctx.storage;
    const ledger = {
      read: async () => (await store.get("usage")) || emptyLedger(),
      reserve: async (input) =>
        store.transaction(async (transaction) => {
          const state = (await transaction.get("usage")) || emptyLedger();
          await transaction.put("usage", reserveTrial(state, input));
        }),
      finish: async (visitor, status) =>
        store.transaction(async (transaction) => {
          const state = (await transaction.get("usage")) || emptyLedger();
          await transaction.put("usage", finishTrial(state, visitor, status));
        }),
    };
    try {
      return await handleOrderAPI(request, this.env, ledger);
    } finally {
      if (interpretation) this.inflight--;
    }
  }
}
export default {
  async fetch(request, env) {
    if (!new URL(request.url).pathname.startsWith("/api/order-checker/"))
      return new Response("Not found.", { status: 404 });
    return env.TRIAL_LEDGER.getByName("public-order-checker-trials").fetch(
      request,
    );
  },
};
