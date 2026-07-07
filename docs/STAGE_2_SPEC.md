# Stage 2 — Acquire writes to the cloud (spec for terminal Claude)

**Do this work in the `Q._OS` repo (terminal), not the design project.** Only the repo deploys, and
editing the design copy risks re-stranding real client data (the safety classifier blocks that push).

## Goal
Two things, both gated behind "is the API up and am I in an org" so there's **zero regression when
offline** (same fallback pattern Stage 1 already uses):

1. **Seed a fresh workspace** — a brand-new org loads an empty board today. On first load of an empty
   org, push the local demo defaults up to the cloud so the board isn't blank.
2. **Persist edits** — every edit in Acquire (stage move, field change, add, remove, round change,
   log entry) saves to the cloud, so a second person on the same org sees it.

## Where Stage 1 left off (in `acquire/Acquire.dc.html`)
- `initApi()` runs on mount → if signed in with an org, calls `loadFromApi(orgId)`.
- `loadFromApi()` reads `deals`/`firms`/`rounds`, maps deals→investors via `dealToInvestor(d, firm)`,
  and **if `deals.length === 0` it just keeps the local view** (`cloudStatus:"online"`) — it does not
  write anything. That empty branch is where seeding goes.
- All local mutations still write only to `localStorage`. The legacy `SYNC`/`cloudEnabled()` path is
  the OLD Worker (syncUrl blank → disabled); **do not reuse it** — add a clean `/api` write path.
- `dealToInvestor()` already reads rich fields back out of the deal's `data` JSON column. So the
  write side just needs to put them there.

## API contract (confirmed in `docs/FRONTEND_INTEGRATION.md` + schema)
- Same-origin `/api`, cookie session, `credentials:"include"` (Stage 1's `apiFetch()` already does this).
- `POST /orgs/:orgId/firms { name, description, type }` → `{ firm }` (create the firm first).
- `POST /orgs/:orgId/deals { round_id, firm_id, stage, confidence, role, ticket_target, next_step, data }` → `{ deal }`.
- `PUT  /orgs/:orgId/deals/:id { ...same fields }` → update.
- `DELETE /orgs/:orgId/deals/:id`.
- `POST /orgs/:orgId/rounds { is_active, target_amount, data }` / `PUT /orgs/:orgId/rounds/:id`.
- `POST /orgs/:orgId/deals/reorder { updates:[{id,stage,sort_order}] }` (that's Stage 3, not now).
- **Amounts are integer minor units (cents).** `ticket_target` for "€6M" = `600000000`.
- The `data` TEXT column on `deals` and `rounds` carries all rich fields not in structured columns.

## Design: local is source of truth, mirror to cloud via the `data` column
Keep it simple. The `data` JSON column is the primary store for rich card fields; the structured
columns (`stage`, `confidence`, `role`, `ticket_target`, `next_step`) are filled too so the data is
queryable and Stage 1's reader stays happy. Last-write-wins for now (real merge/refetch = Stage 3).

### New methods to add to the logic class
```js
apiWritable() { return !!(this.state.apiUp && this.state.apiOrg) && !this.isReadOnly(); }

ticketToCents(str) {                       // inverse of centsToTicket("€6M") = 600000000
  const m = parseFloat(String(str || "").replace(/[^0-9.]/g, ""));
  return isFinite(m) && m > 0 ? Math.round(m * 1e6 * 100) : null;   // €M → cents
}

dealBody(inv, roundId) {
  return {
    round_id: roundId,
    stage: inv.stage, confidence: inv.confidence, role: inv.role,
    ticket_target: this.ticketToCents(inv.ticket),
    next_step: inv.context || "",
    data: JSON.stringify({                 // everything dealToInvestor() reads back
      name: inv.name, sub: inv.sub, stage: inv.stage, owner: inv.owner,
      confidence: inv.confidence, role: inv.role, ticket: inv.ticket,
      nextContact: inv.nextContact, context: inv.context,
      leadCandidate: !!inv.leadCandidate, continue: inv.continue,
      notes: inv.notes || "", checks: inv.checks || {}, fields: inv.fields || {},
    }),
  };
}

// Seed an empty org from the current local investors + round (runs once, from loadFromApi's empty branch)
async seedWorkspace(orgId) {
  const base = "/orgs/" + orgId;
  // 1. active round
  const r = await this.apiFetch(base + "/rounds", { body: {
    is_active: 1, target_amount: (this.CONFIG.roundTargetM || 15) * 1e6 * 100,
    data: JSON.stringify(this.state.round || {}),
  }});
  const roundId = r.round.id;
  // 2. firm + deal per local investor; swap local id → server deal id
  const mapped = [];
  for (const inv of this.state.investors) {
    const f = await this.apiFetch(base + "/firms", { body: {
      name: inv.name || "Untitled", description: inv.sub || "", type: (inv.fields && inv.fields["db:type"]) || "",
    }});
    const d = await this.apiFetch(base + "/deals", { body: { firm_id: f.firm.id, ...this.dealBody(inv, roundId) }});
    mapped.push({ ...inv, id: d.deal.id });
  }
  this._roundId = roundId;
  this.setState({ investors: mapped }); this.save(mapped);
}

// Debounced upsert of dirty deals + the round
markApiDirty(id) { if (!this.apiWritable()) return; (this._apiDirty ||= new Set()).add(id); this._scheduleApiFlush(); }
markRoundApiDirty() { if (!this.apiWritable()) return; this._roundDirtyApi = true; this._scheduleApiFlush(); }
_scheduleApiFlush() { clearTimeout(this._apiT); this._apiT = setTimeout(() => this.flushApi(), 1200); }

async flushApi() {
  if (!this.apiWritable()) return;
  const org = this.state.apiOrg.id, base = "/orgs/" + org, roundId = this._roundId;
  const ids = [...(this._apiDirty || [])]; this._apiDirty = new Set();
  for (const id of ids) {
    const inv = this.state.investors.find(x => x.id === id);
    if (!inv) { try { await this.apiFetch(base + "/deals/" + id, { method: "DELETE" }); } catch (e) {} continue; }
    try { await this.apiFetch(base + "/deals/" + id, { method: "PUT", body: this.dealBody(inv, roundId) }); } catch (e) {}
  }
  if (this._roundDirtyApi) { this._roundDirtyApi = false;
    try { await this.apiFetch(base + "/rounds/" + roundId, { method: "PUT", body: { data: JSON.stringify(this.state.round || {}) }}); } catch (e) {} }
}
```

### Wire-ups
- In `loadFromApi()`: capture `this._roundId = rr.id` when a round loads. In the **empty branch**
  (`if (!deals.length)`) call `await this.seedWorkspace(orgId)` instead of just returning.
- After the local `setState`/`save` in each mutator, add a cloud mirror when `apiWritable()`:
  - `update(id,…)`, `setStage(id,…)`, `setField(id,…)`, `addLogEntry(id)` → `this.markApiDirty(id)`.
  - `add()` → after the local row exists, `markApiDirty(newId)` (flushApi should **POST-create** a
    deal when the id isn't a server id yet, then swap the local id to the returned server id — add a
    small `isServerId(id)` check, e.g. server ids are UUIDs/not `seed*`/`inv<digits>`).
  - `remove(id)` → `markApiDirty(id)` (flushApi deletes when the investor is gone from state).
  - `setRound(…)` → `this.markRoundApiDirty()`.
- Everything stays gated: if `apiWritable()` is false (offline/local preview), behaviour is exactly
  today's localStorage-only path. **No regression.**

## Before coding — confirm two things in `backend/src/routes/resources.js`
1. Does `POST /deals` accept and store `data`, `confidence`, `role`, `ticket_target`, `next_step`?
   (Schema has the `data` column per the July note; confirm the route writes it.)
2. Does `POST /firms` return `{ firm: { id } }` and `POST /deals` return `{ deal: { id } }`? Adjust
   the `.firm.id` / `.deal.id` reads to match the real response shape.

## Test in prod (after deploy)
1. New account → empty org → **seedWorkspace** fills the board with the Northwind demo. Reload → data
   persists (now coming from the API, not localStorage).
2. Move a card / edit a ticket → reload → change persisted.
3. Second browser (or incognito) on the same org → sees the same board. (Live refresh = Stage 3.)
4. Delete a card → gone after reload.

## Not in Stage 2 (that's Stage 3)
Kanban drag-order persistence (`deals/reorder`) and periodic refetch-on-focus for multiplayer
freshness. Ship Stage 2 first.
