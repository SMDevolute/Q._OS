# Q. OS Backend (Cloudflare Worker + D1 + R2 + KV)

Phase 1 is built: **auth** (accounts, sessions, magic links, password reset) and
**organizations + memberships + invites** (the multi-tenant core). It runs inside the *same*
Worker that serves the app, so the API is same-origin at `/api/*`.

## Security design (what makes it safe)
- **Passwords:** PBKDF2-HMAC-SHA256, 210k iterations, per-password random salt, plus a server-side
  **pepper** secret mixed in — so a leaked DB can't be cracked offline with the DB alone.
- **Sessions & links:** the raw token lives only in an **httpOnly, Secure, SameSite=Lax** cookie
  (or a one-time email link). The DB stores only the **SHA-256 hash** — a DB leak grants no sessions.
- **CSRF:** all mutations require the `Origin` header to match `APP_ORIGIN` (defense in depth on top
  of SameSite cookies).
- **Enumeration & brute force:** login/magic/reset are **rate-limited** (per email + per IP via KV);
  login errors are identical whether the email exists or not; magic/reset always respond "ok".
- **Authorization:** every `/api` call is scoped to an org the caller is an **active member** of,
  with a **role hierarchy** (owner > admin > operator > member > viewer). The last owner can't be removed.
- **Sessions are revoked** on password reset.
- **Input validation** on every field; JSON body size capped.

## One-time setup (run from `backend/`)
```bash
# 1. Create the resources (note the IDs printed and paste into wrangler.toml)
wrangler d1 create q-os
wrangler r2 bucket create q-os-files
wrangler kv namespace create RATE

# 2. Create the schema
wrangler d1 execute q-os --remote --file=./schema.sql

# 3. Set secrets (never committed)
wrangler secret put SESSION_PEPPER      # paste a long random string
wrangler secret put RESEND_API_KEY      # optional: email provider for links/invites
wrangler secret put MAIL_FROM           # optional: "Q. OS <no-reply@yourdomain>"
# APP_ORIGIN is in wrangler.toml [vars]; set it to the deployed URL.

# 4. Deploy (or just push — Workers Builds auto-deploys)
wrangler deploy
```
> **Assets note:** `wrangler.toml` serves the repo root as static assets. Add an `.assetsignore`
> at the repo root containing `q-os-deploy/` so the backend source/docs aren't served publicly.
> (Long-term, move the app files into a `public/` dir and point `[assets] directory` there.)

## API surface (Phase 1)
```
GET  /api/health
POST /api/auth/signup            { email, name?, password }        → sets session cookie
POST /api/auth/login             { email, password }               → sets session cookie
POST /api/auth/logout
GET  /api/auth/me                                                   → { user, orgs }
POST /api/auth/magic/request     { email }                          → emails a sign-in link
POST /api/auth/magic/consume     { token }                          → sets session cookie
POST /api/auth/password/request  { email }                          → emails a reset link
POST /api/auth/password/reset    { token, password }

GET    /api/orgs                                                    → orgs I belong to
POST   /api/orgs                 { name, legal_name?, base_currency? }
PATCH  /api/orgs/:id             { name?, engagement_status? }      → admin+  (churn = set 'churned')
GET    /api/orgs/:id/members
POST   /api/orgs/:id/invites     { email, role }                   → admin+
PATCH  /api/orgs/:id/members/:userId  { role }                     → admin+
DELETE /api/orgs/:id/members/:userId                               → admin+  (Evolute churn = remove membership)
POST   /api/orgs/invites/accept  { token }
```

## API surface (Phase 2 — domain data)
All nested under an org you're a member of. **GET** needs role ≥ viewer; **POST/PATCH/DELETE** need
role ≥ member (viewer is rejected). Deletes are soft where the table has `deleted_at`.
```
GET|POST         /api/orgs/:orgId/rounds            fields: name,kind,target_amount,currency,premoney,status,open_date,target_close,is_active
GET|POST         /api/orgs/:orgId/firms             fields: name,type,website,description,location            ?type=
GET|POST         /api/orgs/:orgId/contacts          fields: firm_id,name,title,email,phone,linkedin,is_primary ?firm_id=
GET|POST         /api/orgs/:orgId/deals             fields: round_id,firm_id,stage,owner_user_id,confidence,role,ticket_target,sort_order,next_step,next_step_due  ?round_id= ?firm_id= ?stage=
GET|POST         /api/orgs/:orgId/commitments       fields: deal_id,amount,currency,instrument,status,committed_at  ?deal_id=
GET|POST         /api/orgs/:orgId/notes             fields: subject_type,subject_id,body,pinned               ?subject_type= ?subject_id=
GET|POST         /api/orgs/:orgId/tasks             fields: title,assignee_id,due_at,status,subject_type,subject_id  ?status= ?assignee_id=
PATCH|DELETE     /api/orgs/:orgId/<resource>/:id
POST             /api/orgs/:orgId/deals/reorder     { updates:[{id,stage,sort_order}] }   -- kanban drag
```
Money fields are integer minor units (cents); timestamps are unix seconds. List responses are
`{ "<resource>": [...] }`; single-item responses are `{ "<singular>": {...} }`.
See `../docs/FRONTEND_INTEGRATION.md` for porting the Acquire UI onto these.
Email links land on the app with `#magic_link=…`, `#password_reset=…`, or `#invite=…` in the URL;
the frontend reads the fragment and POSTs it to the matching `consume`/`reset`/`accept` endpoint.

## Files
```
backend/
  wrangler.toml          bindings (DB, FILES, RATE, ASSETS) + secret names
  schema.sql             the full D1 schema (v1)
  src/worker.js          entry: /api router + static passthrough
  src/lib/crypto.js      PBKDF2 hashing, token gen, constant-time compare
  src/lib/http.js        responses, cookies, CSRF origin check
  src/lib/db.js          D1 helpers + validators
  src/lib/auth.js        sessions, current-user, role checks
  src/lib/email.js       Resend (or dev-log) sender
  src/routes/auth.js     signup/login/logout/me/magic/password
  src/routes/orgs.js     orgs, memberships, invites
```

## Next (Phase 2)
Mount `firms`, `contacts`, `deals` (kanban), `commitments`, `rounds`, `notes`, `tasks` under
`/api/*` (all `org_id`-scoped), then port the Acquire UI off `localStorage` onto `fetch('/api/...')`.
See `../docs/DATA_MODEL.md`.
