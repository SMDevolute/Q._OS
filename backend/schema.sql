-- ============================================================================
-- Q. OS — D1 schema (v1)
-- Cloudflare D1 (SQLite). One database, multi-tenant by org_id.
-- Conventions:
--   * IDs are TEXT (UUID/ULID generated in the Worker).
--   * Timestamps are INTEGER unix epoch SECONDS (UTC).
--   * Money is INTEGER minor units (euro cents) + a currency code. Never floats.
--   * Every tenant-scoped row carries org_id and is indexed on it.
--   * Soft-delete via deleted_at (NULL = live) where history matters.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. IDENTITY & TENANCY
-- ─────────────────────────────────────────────────────────────────────────

-- A person. One global account across the whole platform.
CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,          -- lowercased
  name           TEXT,
  password_hash  TEXT,                          -- NULL if magic-link-only; format: pbkdf2$iter$saltB64$hashB64
  email_verified INTEGER NOT NULL DEFAULT 0,
  avatar_url     TEXT,
  created_at     INTEGER NOT NULL,
  last_login_at  INTEGER
);

-- Server-side sessions. The raw token lives ONLY in the user's httpOnly cookie.
-- We store just its SHA-256 hash, so a DB leak cannot be used to impersonate anyone.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,                  -- sha256(raw cookie token)
  id         TEXT NOT NULL,                     -- public session id (for listing / revoke)
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT,
  ip         TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Magic-link / password-reset / invite one-time tokens. Same rule: store only the hash.
CREATE TABLE login_tokens (
  token_hash TEXT PRIMARY KEY,                  -- sha256(raw token sent in the email link)
  email      TEXT NOT NULL,
  purpose    TEXT NOT NULL,                     -- 'magic_link' | 'password_reset' | 'invite'
  org_id     TEXT REFERENCES organizations(id) ON DELETE CASCADE, -- for invites
  role       TEXT,                              -- role to grant if this is an invite
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX idx_login_tokens_email ON login_tokens(email);

-- The TENANT. One organization = one company's Q. OS instance (the "workspace").
-- Persists for the life of the company, independent of any consultancy engagement.
CREATE TABLE organizations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,                 -- e.g. "Northwind Materials"
  legal_name    TEXT,
  slug          TEXT UNIQUE,                   -- URL/subdomain key
  logo_url      TEXT,
  base_currency TEXT NOT NULL DEFAULT 'EUR',
  -- lifecycle of the Evolute *consultancy* engagement (NOT tool access):
  engagement_status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'churned' | 'none'
  created_at    INTEGER NOT NULL,
  deleted_at    INTEGER
);

-- Which users belong to which org, and their role IN that org.
-- Evolute staff hold memberships in many orgs (role='operator'); clients in their own.
CREATE TABLE memberships (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,                    -- 'owner' | 'admin' | 'operator' | 'member' | 'viewer'
  status     TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'invited' | 'suspended'
  created_at INTEGER NOT NULL,
  UNIQUE (org_id, user_id)
);
CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_memberships_org  ON memberships(org_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. ROUNDS  (a company raises many over its lifetime)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE rounds (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,                 -- e.g. "Series A"
  kind          TEXT,                          -- 'equity' | 'convertible' | 'debt' | 'grant' | 'mixed'
  target_amount INTEGER,                        -- cents, new money target
  currency      TEXT NOT NULL DEFAULT 'EUR',
  premoney      INTEGER,                        -- cents
  status        TEXT NOT NULL DEFAULT 'open',  -- 'planning' | 'open' | 'closing' | 'closed'
  open_date     INTEGER,
  target_close  INTEGER,
  is_active     INTEGER NOT NULL DEFAULT 1,     -- the round currently shown by default
  created_at    INTEGER NOT NULL,
  deleted_at    INTEGER
);
CREATE INDEX idx_rounds_org ON rounds(org_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. INVESTOR PIPELINE  (Acquire)
-- ─────────────────────────────────────────────────────────────────────────

-- An investor entity: VC, family office, strategic, public co-investor, bank…
CREATE TABLE firms (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,                   -- e.g. "Atlas Ventures"
  type        TEXT,                            -- 'vc' | 'family_office' | 'strategic' | 'public' | 'bank' | 'angel' | 'other'
  website     TEXT,
  description TEXT,
  location    TEXT,
  created_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE INDEX idx_firms_org ON firms(org_id);

-- A person at a firm.
CREATE TABLE contacts (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  firm_id     TEXT REFERENCES firms(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  title       TEXT,
  email       TEXT,
  phone       TEXT,
  linkedin    TEXT,
  is_primary  INTEGER NOT NULL DEFAULT 0,      -- primary contact at the firm
  created_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE INDEX idx_contacts_org  ON contacts(org_id);
CREATE INDEX idx_contacts_firm ON contacts(firm_id);
CREATE INDEX idx_contacts_email ON contacts(email);

-- A firm's participation in a specific round = one kanban/funnel card.
CREATE TABLE deals (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  round_id       TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  firm_id        TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  stage          TEXT NOT NULL,                -- funnel column: 'outreach' | 'conversation' | 'pitch' | 'dataroom' | 'terms' | 'committed' | 'passed'
  owner_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  confidence     TEXT,                         -- 'committed' | 'probable' | 'possible' | 'unset'
  role           TEXT,                         -- 'lead' | 'co-investor' | 'subsidy' | 'follow' …
  ticket_target  INTEGER,                       -- cents, expected ticket
  sort_order     INTEGER NOT NULL DEFAULT 0,   -- position within the stage column
  next_step      TEXT,
  next_step_due  INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER,
  UNIQUE (round_id, firm_id)
);
CREATE INDEX idx_deals_org   ON deals(org_id);
CREATE INDEX idx_deals_round ON deals(round_id);
CREATE INDEX idx_deals_stage ON deals(round_id, stage);

-- Money committed/soft-committed (a deal can have multiple tranches/instruments).
CREATE TABLE commitments (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id     TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  amount      INTEGER NOT NULL,                -- cents
  currency    TEXT NOT NULL DEFAULT 'EUR',
  instrument  TEXT,                            -- 'equity' | 'convertible' | 'deferral' | 'grant' | 'debt'
  status      TEXT NOT NULL DEFAULT 'soft',    -- 'soft' | 'hard' | 'wired' | 'withdrawn'
  committed_at INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_commitments_deal ON commitments(deal_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. ACTIVITY  (notes, tasks) — polymorphic across firms/contacts/deals
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE notes (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subject_type  TEXT NOT NULL,                 -- 'firm' | 'contact' | 'deal' | 'round'
  subject_id    TEXT NOT NULL,
  author_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  body          TEXT NOT NULL,
  pinned        INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  deleted_at    INTEGER
);
CREATE INDEX idx_notes_subject ON notes(org_id, subject_type, subject_id);

CREATE TABLE tasks (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  assignee_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  due_at        INTEGER,
  status        TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'done'
  subject_type  TEXT,                          -- optional link to firm/contact/deal
  subject_id    TEXT,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL,
  completed_at  INTEGER
);
CREATE INDEX idx_tasks_org ON tasks(org_id, status);

-- ─────────────────────────────────────────────────────────────────────────
-- 5. DATAROOM  (Close) — folder tree in D1, bytes in R2
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE folders (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id  TEXT REFERENCES folders(id) ON DELETE CASCADE,   -- NULL = root
  name       TEXT NOT NULL,
  round_id   TEXT REFERENCES rounds(id) ON DELETE SET NULL,   -- optionally scope a dataroom to a round
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_folders_org    ON folders(org_id);
CREATE INDEX idx_folders_parent ON folders(parent_id);

CREATE TABLE files (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  folder_id   TEXT REFERENCES folders(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  r2_key      TEXT NOT NULL,                   -- object key in R2, e.g. org/{org_id}/files/{uuid}
  mime        TEXT,
  size_bytes  INTEGER,
  version     INTEGER NOT NULL DEFAULT 1,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE INDEX idx_files_org    ON files(org_id);
CREATE INDEX idx_files_folder ON files(folder_id);

-- Per-firm access to dataroom items (Close): who can see what.
CREATE TABLE dataroom_grants (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  firm_id    TEXT REFERENCES firms(id) ON DELETE CASCADE,
  folder_id  TEXT REFERENCES folders(id) ON DELETE CASCADE,
  can_edit   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_grants_org ON dataroom_grants(org_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 6. EMAIL SYNC  (per-contact email pulled from Gmail/Outlook) — later phase
--    OAuth tokens encrypted at rest; large bodies live in R2, metadata here.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE email_accounts (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,                 -- 'gmail' | 'outlook'
  email         TEXT NOT NULL,
  access_token  TEXT,                          -- encrypted
  refresh_token TEXT,                          -- encrypted
  token_expires INTEGER,
  sync_state    TEXT,                          -- provider cursor / historyId
  last_sync_at  INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_email_accounts_org ON email_accounts(org_id);

CREATE TABLE email_messages (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id    TEXT REFERENCES email_accounts(id) ON DELETE SET NULL,
  provider_msg_id TEXT,
  thread_id     TEXT,
  direction     TEXT,                          -- 'in' | 'out'
  from_email    TEXT,
  to_emails     TEXT,                          -- comma-separated
  subject       TEXT,
  snippet       TEXT,
  body_r2_key   TEXT,                          -- full body in R2
  sent_at       INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_email_msgs_org    ON email_messages(org_id);
CREATE INDEX idx_email_msgs_thread ON email_messages(thread_id);

-- Link an email to the contact card(s) it belongs to.
CREATE TABLE email_contact_links (
  message_id TEXT NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, contact_id)
);

-- ─────────────────────────────────────────────────────────────────────────
-- 7. CAP TABLE & VALUATION  (Retain)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE share_classes (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,                    -- 'Common' | 'Series A Preferred' …
  liq_pref   REAL,                             -- e.g. 1.0
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_share_classes_org ON share_classes(org_id);

-- Who holds what. Holder may be a firm, a contact, or a named entity (founder/pool).
CREATE TABLE holdings (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  holder_type   TEXT NOT NULL,                 -- 'firm' | 'contact' | 'entity'
  holder_id     TEXT,                          -- firm_id/contact_id, or NULL for named entity
  holder_name   TEXT,                          -- for 'entity' (e.g. "Option pool", "Founders")
  share_class_id TEXT REFERENCES share_classes(id) ON DELETE SET NULL,
  round_id      TEXT REFERENCES rounds(id) ON DELETE SET NULL,
  shares        INTEGER,
  price_per_share INTEGER,                       -- cents
  invested      INTEGER,                          -- cents
  issued_at     INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_holdings_org ON holdings(org_id);

CREATE TABLE valuations (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  round_id   TEXT REFERENCES rounds(id) ON DELETE SET NULL,
  premoney   INTEGER,                          -- cents
  postmoney  INTEGER,                          -- cents
  method     TEXT,
  as_of      INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_valuations_org ON valuations(org_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 8. FX RATES  (multi-currency rollups; display in org base_currency)
--    Amounts are stored in their own currency; to sum across currencies,
--    convert via the latest rate to the org base currency.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE fx_rates (
  id            TEXT PRIMARY KEY,
  org_id        TEXT REFERENCES organizations(id) ON DELETE CASCADE, -- NULL = platform default
  base_currency TEXT NOT NULL,                 -- e.g. 'EUR'
  quote_currency TEXT NOT NULL,                -- e.g. 'USD'
  rate          REAL NOT NULL,                 -- 1 base = <rate> quote
  as_of         INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_fx_rates_lookup ON fx_rates(org_id, base_currency, quote_currency, as_of);

-- ============================================================================
-- End of schema v1. Migrations go in backend/migrations/ as numbered files.
-- ============================================================================
