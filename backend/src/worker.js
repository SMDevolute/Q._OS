// worker.js — single entry point.
//   /api/*  → JSON backend (this file routes it)
//   else    → static app served from the [assets] binding
import { HttpError, json, assertSameOrigin } from "./lib/http.js";
import { handleAuth } from "./routes/auth.js";
import { handleOrgs } from "./routes/orgs.js";

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (url.pathname.startsWith("/api/")) {
      try {
        assertSameOrigin(req, env); // CSRF defense on all mutations
        return await route(req, env, url);
      } catch (err) {
        if (err instanceof HttpError) return json({ error: err.message, code: err.code }, err.status);
        console.error("unhandled", err && err.stack || err);
        return json({ error: "Internal error" }, 500);
      }
    }

    // Everything else = the static Q. OS app.
    return env.ASSETS.fetch(req);
  },
};

async function route(req, env, url) {
  // path after /api/
  const segs = url.pathname.replace(/^\/api\//, "").replace(/\/+$/, "").split("/");
  const head = segs.shift();

  if (head === "health") return json({ ok: true });
  if (head === "auth") return handleAuth(req, env, segs.join("/"));
  if (head === "orgs") return handleOrgs(req, env, segs);

  // Phase 2+ mounts here: firms, contacts, deals, rounds, notes, tasks,
  // folders, files, cap-table — all scoped by org membership.
  throw new HttpError(404, "Not found");
}
