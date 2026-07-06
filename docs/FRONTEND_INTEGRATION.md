# Frontend integration — porting Acquire onto the API (Phase 2)

For the frontend collaborator. Goal: move the Acquire module off `localStorage` onto the live
`/api` so multiple people share one workspace. The DC/static architecture does **not** change —
only the data source.

## The shape of it
- The API is **same-origin** at `/api`, so calls are just `fetch('/api/...')` — no CORS, no base URL.
- Auth is a **cookie session** set at login. Send `credentials: 'include'` on every request so the
  cookie rides along. No tokens to manage in JS.
- All domain data lives under the current org: `/api/orgs/:orgId/<resource>`. Get the user's orgs
  (and the active one) from `GET /api/auth/me`.

## A tiny client helper
```js
async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "include",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { /* not signed in → show landing/login */ throw new Error("unauthorized"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// bootstrapping
const { user, orgs } = await api("/auth/me");
const orgId = orgs[0].id;                              // or a workspace picker
const { deals } = await api(`/orgs/${orgId}/deals?round_id=${roundId}`);
```

## Mapping the current Acquire model → API
| Acquire (localStorage) | API entity | Notes |
|---|---|---|
| `round` config | `rounds` | one active round has `is_active=1`; amounts in cents |
| investor row (firm + stage + confidence + amount) | a **firm** + a **deal** | firm = the entity; deal = its participation in the round (the kanban card) |
| person at investor | `contacts` (`firm_id`) | |
| committed/soft amounts | `commitments` (`deal_id`) | multiple tranches allowed |
| log/notes on a card | `notes` (`subject_type='deal'`, `subject_id=dealId`) | also works for firm/contact |
| to-dos / next actions | `tasks` | or `deals.next_step` for the inline one |

## Funnel / kanban
- Columns = `deals.stage`. Load with `GET /orgs/:orgId/deals?round_id=…`.
- On drag, persist positions in one call: `POST /orgs/:orgId/deals/reorder { updates:[{id,stage,sort_order}] }`.
- Create a card = `POST /orgs/:orgId/deals { round_id, firm_id, stage }` (create/pick the firm first).

## Suggested porting order
1. Add the `api()` helper + a session gate (if `me` has no user → show the landing/login).
2. Read paths first: render firms/contacts/deals/rounds from the API instead of seeded localStorage.
3. Then writes: create/update/delete + the kanban reorder call.
4. Keep `localStorage` only as an **offline cache** (optional): write-through on success, read on load
   for instant paint, reconcile after the fetch resolves.
5. Flip `CONFIG.syncUrl` to `"/api"` and remove the demo seed for real orgs (a fresh org starts empty).

## Multiplayer freshness
Phase 2 is request/response (no live push yet). For "feels live": refetch on window focus and every
~20–30s while a board is open. True realtime (push) can come later via a Durable Object without
changing these endpoints.

## Roles
`GET /auth/me` → each org carries your `role`. If `viewer`, render everything but hide/disable
mutations — the server also rejects writes from viewers (403), so treat that as the backstop.
