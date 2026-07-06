// worker.js — single entry point.
//   /api/*  → JSON backend (this file routes it)
//   else    → static app served from the [assets] binding
import { HttpError, json, assertSameOrigin } from "./lib/http.js";
import { handleAuth } from "./routes/auth.js";
import { handleOrgs } from "./routes/orgs.js";
import { handleResource, RESOURCE_NAMES } from "./routes/resources.js";
import { getUser, requireOrgRole } from "./lib/auth.js";

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

  if (head === "orgs") {
    // Nested domain resources: /api/orgs/:orgId/<resource>/...
    const orgId = segs[0];
    const resource = segs[1];
    if (orgId && RESOURCE_NAMES.includes(resource)) {
      const user = await getUser(env, req);
      const minRole = req.method === "GET" ? "viewer" : "member";
      const role = await requireOrgRole(env, orgId, user, minRole);
      return handleResource(req, env, resource, segs.slice(2), { orgId, role, user });
    }
    // Otherwise: org CRUD, members, invites.
    return handleOrgs(req, env, segs);
  }

  throw new HttpError(404, "Not found");
}
