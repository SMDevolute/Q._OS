# Q. OS Backend — readiness review (July 7, 2026)

Reviewed the full deployed backend (`worker.js`, `lib/*`, `routes/*`, `schema.sql`, `wrangler.toml`)
against four questions: is it **safe**, **robust**, **multi-client (isolated + scalable)**, and
**comprehensive**. Short answer: **yes on all four — this is a solid, professional foundation.**
Below is what's strong, then a prioritized fix list before a big frontend build lands on it.

## Verdict by criterion
- **Safe:** strong. Modern auth done right (see below). No SQL injection surface. Good input validation.
- **Robust:** good. Central error handling, soft-deletes, unique constraints, indexed, typed coercion.
- **Multi-client isolation:** strong. Every row carries `org_id`; every query filters by it; every route
  checks org membership + role first. One integrity gap (cross-org FK refs on write) — see fixes.
- **Comprehensive:** the **schema already models the entire product** — Acquire, Close (dataroom),
  Retain (cap table), email sync, multi-currency — before the UI exists. API currently covers Acquire.

## What's strong (don't touch)
**Auth & sessions**
- Passwords: PBKDF2-SHA256, per-hash random salt, + a server-side **pepper** (`SESSION_PEPPER`) so a DB
  leak alone can't crack hashes. Stored format encodes the iteration count → future-proof/upgradable.
- Sessions: 256-bit random token; **only its SHA-256 hash is stored** (DB leak can't impersonate);
  cookie is `HttpOnly; Secure; SameSite=Lax`; 30-day TTL; password reset kills all sessions.
- **CSRF:** SameSite cookie + explicit Origin allow-list (`APP_ORIGIN`) on every mutation.
- Timing-safe hash compare; identical login error for bad-email vs bad-password (no user enumeration);
  magic/reset always return ok (no enumeration).
- **Rate limiting** (KV): login 8/15min per email + 30/15min per IP; magic/reset 5/15min.

**Tenant isolation & roles**
- Domain routes are nested under `/api/orgs/:orgId/<resource>`; `requireOrgRole()` checks an **active
  membership** with sufficient role *before* any resource handler runs. GET=viewer, writes=member,
  member management=admin, ownership grant=owner-only, last-owner protection on removal.
- Every resource query is `WHERE org_id = ?` (+ soft-delete filter); every update/delete is
  `... AND org_id = ?`. A user in org A cannot read or write org B's rows.
- Tenancy model matches the design: orgs permanent, access via memberships, `engagement_status`
  tracks the consultancy relationship separately from tool access (churn never deletes data).

**Data integrity & SQL**
- All SQL parameterized (`.bind()`); table/column names come from a fixed server-side whitelist
  (`ENTITIES`), never from user input → no injection surface.
- FKs declared with sensible `ON DELETE CASCADE`/`SET NULL`; unique constraints on `users.email`,
  `memberships(org_id,user_id)`, `deals(round_id,firm_id)`; indexes on every `org_id` + hot lookups.
- Money is integer minor units + currency everywhere (no floats); timestamps unix-seconds UTC.

## Fix list before the big frontend build

### 🔴 Do first (real exposure / safety)
1. **Add `.assetsignore` at repo root.** The `[assets]` dir is the whole repo root (`../`), so
   `backend/` source and `q-os-deploy/` docs are likely **served publicly** (e.g.
   `GET /backend/schema.sql`, `/backend/src/lib/crypto.js`). No secrets are in code (they're in Worker
   env), so it's *source/schema disclosure*, not a credential leak — but it shouldn't be public.
   **Verify:** `curl -L https://q-os.rob-803.workers.dev/backend/schema.sql` (and `/q-os-deploy/...`).
   **Fix:** create `.assetsignore` at repo root listing `backend/`, `q-os-deploy/`, `*.md`, `.git*`;
   redeploy; re-curl to confirm 404.

### 🟠 Should do (integrity + abuse hardening)
2. **Validate foreign-key ownership on writes.** `POST/PATCH` for deals/contacts/commitments/notes
   accept `round_id`/`firm_id`/`deal_id`/`subject_id`/`owner_user_id` from the body but don't check
   those belong to the caller's org. Can't leak data on read (reads are org-filtered), but you can
   create rows that reference another tenant's ids. Add a small `belongsToOrg(table, id, orgId)` check
   for each incoming FK in `resources.js`.
3. **Rate-limit signup and org creation.** Login/magic/reset are throttled; `POST /auth/signup` and
   `POST /orgs` are not — someone could mass-create accounts/workspaces. Add a per-IP KV limit
   (e.g. signup 10/hour/IP).
4. **Confirm D1 actually enforces foreign keys / cascades.** D1 (SQLite) historically does **not**
   enforce FK constraints at runtime even with `PRAGMA foreign_keys=ON` in the schema file. If not
   enforced, `ON DELETE CASCADE` won't fire (e.g. deleting an org won't clean its rows).
   **Verify** with a scratch org; if unenforced, either rely on soft-delete (mostly already do) or add
   explicit cascade cleanup on hard deletes.

### 🟡 Nice to have (operational hygiene, not blockers)
5. **Sweep expired sessions/tokens** with a Workers Cron trigger (they're deleted lazily on access but
   never purged) — keeps `sessions`/`login_tokens` lean.
6. **`deals/reorder`**: batch the loop of UPDATEs via `env.DB.batch()` for atomicity + speed (fine as-is
   up to a few hundred).
7. **Audit log** (who changed what, when) — valuable for a multi-client consultancy tool; add later.
8. **Migrations discipline:** schema says migrations live in `backend/migrations/` — keep new changes
   as numbered files there rather than ad-hoc `ALTER`s, so a fresh DB and prod stay in sync.
9. Email verification is recorded but not enforced anywhere — fine for now; gate sensitive actions on it
   later if needed.

## Scale note (many clients)
D1 is single-database SQLite: excellent for **tens–low-hundreds** of client workspaces with normal
usage (a consultancy's client book), and cheap. If you ever reach thousands of high-traffic orgs you'd
revisit (D1 per-DB size/throughput limits; options: split DBs or a larger store). Not a concern at your
foreseeable scale — the schema/indexing choices are right for it.

## Bottom line
Green light to build the frontend on this. Do #1 now (quick, real), schedule #2–#4 before you rely on
multi-tenant integrity in anger, and treat #5–#9 as backlog. Nothing here is a re-architecture — the
foundations (auth, isolation, schema coverage) are done properly.
