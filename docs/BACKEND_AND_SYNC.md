# Backend & Sync — Q. OS

## Current state
- **No backend. No credentials. Nothing to import.** The app runs local-only (`localStorage`).
- The tool was forked from one that synced to a **third-party Cloudflare Worker**; that wiring was
  **deliberately removed**. Acquire's `CONFIG.syncUrl` is `""`. Do not point it at any old URL.

## Goal
Real-time, multi-user workspaces: two people editing the same workspace see each other's changes,
data persists across sessions/devices, and there's a public/team URL. One **Cloudflare Worker** +
a store, owned by us.

## Proposed design (build fresh)
- **Same Worker that serves the app** (add API routes under `/api/` in `src/worker.js`; see
  `DEPLOYMENT.md`) exposing a small JSON API: `GET /api/state?room=…`,
  `POST /api/flush` (batched record upserts + tombstones), and a realtime channel (SSE or WebSocket).
- **Store:** a **Durable Object** per workspace ("room") is the clean fit for live collaboration;
  **KV** or **D1** is fine for a simpler last-write-wins first version. Start simple (KV/D1), move to
  a Durable Object when you want true realtime.
- **Rooms:** one per workspace, e.g. `q-os-northwind` (dev: `q-os-acquire-dev`).
- **Access / roles:** an **edit code** and a **view code** per room. View clients render everything
  but every mutation is a no-op and the Worker rejects their writes. (The app already anticipates a
  read-only mode — a role flag gating mutators — so mirror that: `edit` vs `view`.)

## Client wiring
- The app expects a sync layer keyed off `CONFIG.syncUrl` + `CONFIG.syncRoom` (both in the
  `Component` class in `acquire/Acquire.dc.html`). When `syncUrl` is empty, it stays local.
- To go live: add the `/api/` routes to the app Worker, then set `CONFIG.syncUrl` to `"/api"`
  (same origin as the app) and `CONFIG.syncRoom` to the workspace room. Data still mirrors to
  `localStorage` as an offline cache.

## Secrets & config (NEVER commit)
Create these in **Cloudflare** (Wrangler secrets or the dashboard), not in the repo:
- `EDIT_CODE`, `VIEW_CODE` (per room) — or a small table of them if multi-workspace.
- Any signing secret for tokens if you add auth beyond access codes.
- `wrangler.toml` holds the Worker name, routes, and DO/KV/D1 bindings (safe to commit — no secrets).

## Sequence to stand it up
1. In the app Worker (`src/worker.js`), route `/api/*` to a handler; serve assets otherwise.
2. Implement the API + store (start KV/D1, last-write-wins).
3. `wrangler secret put EDIT_CODE` / `VIEW_CODE`; add the store binding in `wrangler.toml`.
4. Push → Workers Builds redeploys (or `wrangler deploy`).
5. Set `CONFIG.syncUrl = "/api"` in `acquire/Acquire.dc.html`, push → redeploys → multiplayer live.
