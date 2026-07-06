# Deployment — Q. OS on Cloudflare Workers

**Decision:** run the whole thing — the static app now, and the sync API later — as a **single
Cloudflare Worker** using **Workers Static Assets**. One project, one deploy, auto-deploys from Git.

## Why one Worker (not Pages)
- The Worker serves the static files (HTML + `support.js` + `assets/`) directly.
- The *same* Worker will host the sync API (`/api/...`, realtime) when we build it — no second
  project, no CORS between app and API, and shared bindings (KV / D1 / Durable Object).
- Mirrors how the original tool was deployed (one Worker served app + sync).

## Layout
Keep the app files at the repo root and add a `wrangler.toml` + a tiny Worker entry:

```toml
name = "q-os"
main = "src/worker.js"
compatibility_date = "2025-01-01"

[assets]
directory = "./"        # static app: index.html, *.dc.html, support.js, assets/, acquire/, close/, retain/
binding = "ASSETS"
```

```js
// src/worker.js  — initial: pure static passthrough. API routes get added later.
export default {
  async fetch(req, env) {
    // Later: if (new URL(req.url).pathname.startsWith("/api/")) return handleApi(req, env);
    return env.ASSETS.fetch(req);
  }
};
```

> Exclude `src/` and `wrangler.toml` from being served as assets if needed via an `.assetsignore`,
> or keep the app in a `public/` dir and set `directory = "./public"`. Root works fine to start.

## Deploy
- **Auto (recommended):** Cloudflare dashboard → **Workers & Pages → Create → Workers → Connect to
  Git** → pick `q-os`. It builds & deploys on every push (**Workers Builds**).
- **Or CLI:** `wrangler deploy`.

You get a `q-os.<account>.workers.dev` URL that **auto-redeploys on every push to `main`**. Add a
custom domain later in the Worker's settings.

## Verify
Root → landing; **Enter workspace** → launcher; **Acquire** opens the working module; **Close/Retain**
open scaffolds; each module's **← Q. OS** returns to the shell.

## Sync API (next step)
Add routes under `/api/` in `src/worker.js` plus a store binding — see `BACKEND_AND_SYNC.md`. Because
app and API share the origin, the app's `CONFIG.syncUrl` can just be `"/api"` (same-origin) — clean.
