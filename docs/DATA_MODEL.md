# Q. OS — Backend Data Model & Plan (v1)

The authoritative schema is [`backend/schema.sql`](../backend/schema.sql). This doc explains the
shape, the reasoning, and what to build in what order.

## Stack
- **One Cloudflare Worker** serves the app *and* the API (`/api/*`), same origin — no CORS.
- **D1** (SQLite) — all structured/relational data (orgs, users, firms, contacts, deals, notes,
  cap table…). Handles our scale (thousands of contacts + notes per org, several orgs) easily.
- **R2** — the *bytes*: dataroom files, and large email bodies. Metadata rows in D1 point to R2
  keys. R2 has no egress fees, which matters once customers store real documents.
- Keep the big blobs (files, email bodies) **out of D1** — D1 is for relational data and has a
  per-database size cap; R2 is for bulk storage.

## The tenancy model (the important part)
```
users ──< memberships >── organizations (the tenant = one company's Q. OS instance)
                                  │
                                  └──< rounds, firms, contacts, deals, notes, folders, files, … (all carry org_id)
```
- **Organization** = the tenant = a company's whole instance ("workspace"). It holds every module
  and every round the company ever runs. It is **permanent** — it outlives any consultancy engagement.
- **User** = one global person/account across the platform.
- **Membership** = a user's role *inside* one org. A user can be a member of many orgs.
  - Your **3-fold relationship falls out of this cleanly:** Evolute staff hold memberships (role
    `operator`) in each client org during a project. Client staff hold memberships (`owner`/`admin`/
    `member`) in their own org. When the consultancy engagement ends, you **remove the Evolute
    memberships** — the org and all its data persist, the client keeps working. `organizations.
    engagement_status` records the consultancy relationship separately from tool access, so churn is
    a status change + membership change, never data loss.
- **Isolation:** every tenant row carries `org_id` and is indexed on it. Every API query is scoped
  to an org the caller is a member of. (If a single tenant ever gets huge or needs hard isolation,
  we can move to a database-per-tenant later — the `org_id` discipline makes that migration clean.)

### Roles
`owner` · `admin` · `operator` (Evolute) · `member` · `viewer`. Enforced per-org in the Worker.
`viewer` renders everything but every mutation is rejected server-side.

## The nouns (and the one naming rule)
Two different things were both called "company" — kept strictly separate:
- **Organization** = the *raising* company (the tenant, e.g. Northwind Materials).
- **Firm** = an *investor* entity in the pipeline (e.g. Atlas Ventures) — VC, family office,
  strategic, public co-investor, bank, angel.
- **Contact** = a person at a Firm (3–7 per firm).
- **Round** = a raise (Series A, etc.); a company has many over time.
- **Deal** = a Firm's participation in one Round = one kanban/funnel card (stage, owner, confidence,
  ticket, sort order). This is the funnel.
- **Commitment** = money attached to a Deal (can be multiple tranches/instruments).
- **Note / Task** = activity, polymorphic across firm/contact/deal/round.
- **Folder / File** = the dataroom tree (bytes in R2); **dataroom_grants** = per-firm access.
- **Email account / message / link** = per-contact email pulled from Gmail/Outlook.
- **Share class / Holding / Valuation** = the cap table and valuation history.

## Build phases
1. **Foundation** — D1 + schema, Worker `/api` router, **auth** (signup/login, magic link,
   sessions), orgs + memberships + invites. *Nothing else works without this.*
2. **Acquire on the API** — firms, contacts, deals (kanban), commitments, notes, tasks, rounds.
   Port the Acquire UI off `localStorage` onto the API. Real multiplayer here.
3. **Dataroom** — folders + files, R2 upload (presigned/direct-to-Worker), per-firm grants. (Close)
4. **Email sync** — OAuth to Gmail/Outlook, pull messages, link to contacts. (Bigger integration.)
5. **Cap table & valuation** — holdings, share classes, valuations. (Retain)

## Two decisions I need from you
1. **Auth: build our own vs. a provider.** The schema supports our own (passwords hashed with
   WebCrypto/PBKDF2 or scrypt, magic links, sessions). That keeps everything on Cloudflare and costs
   nothing — but auth is security-sensitive and we own every edge case (reset, lockout, verification).
   The alternative is a managed provider (Cloudflare Access, Clerk, Auth0, or Supabase Auth) — faster
   and safer for real accounts, but a second service + credentials. **My lean:** build our own now
   (simple, all-Cloudflare, fits access-code-style sharing) and swap to a provider if/when you need
   SSO, SCIM, or heavy compliance. Tell me your preference.
2. **Currency & multi-currency.** DECIDED: **multi-currency, EUR default.** Money stored as
   integer minor units + a currency code per row; rounds/deals/commitments can differ in currency.
   Rollups that mix currencies must convert via a stored FX rate (add an `fx_rates` table or a
   per-round reporting rate) — keep display currency = org `base_currency` (EUR default).

## Notes for the frontend colleague
- Data shapes above map closely to what Acquire already renders; the port is mostly swapping the
  `localStorage` read/write for `fetch('/api/...')`. Keep `localStorage` as an offline cache.
- IDs become server-generated (TEXT). Amounts are cents on the wire.
- Nothing here changes the DC/static frontend architecture — it stays as-is; only the data source moves.
