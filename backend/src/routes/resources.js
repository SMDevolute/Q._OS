// routes/resources.js — Phase 2 CRUD for the org-scoped domain entities.
// All routes are nested under /api/orgs/:orgId/<resource> so every row is
// inherently scoped to an org the caller belongs to (role checked in worker.js).
import { HttpError, json, readJson } from "../lib/http.js";
import { one, all, run, now } from "../lib/db.js";
import { newId } from "../lib/crypto.js";

// ── entity specs ──────────────────────────────────────────────────────────
// type codes: s=string, i=integer, b=boolean(0/1)
const ENTITIES = {
  rounds: {
    table: "rounds",
    fields: { name: "s", kind: "s", target_amount: "i", currency: "s", premoney: "i",
              status: "s", open_date: "i", target_close: "i", is_active: "b", data: "s" },
    required: ["name"],
    softDelete: true,
    order: "created_at DESC",
    filters: [],
  },
  firms: {
    table: "firms",
    fields: { name: "s", type: "s", website: "s", description: "s", location: "s" },
    required: ["name"],
    softDelete: true,
    order: "name COLLATE NOCASE",
    filters: ["type"],
  },
  contacts: {
    table: "contacts",
    fields: { firm_id: "s", name: "s", title: "s", email: "s", phone: "s", linkedin: "s", is_primary: "b" },
    required: ["name"],
    softDelete: true,
    order: "name COLLATE NOCASE",
    filters: ["firm_id"],
  },
  deals: {
    table: "deals",
    fields: { round_id: "s", firm_id: "s", stage: "s", owner_user_id: "s", confidence: "s",
              role: "s", ticket_target: "i", sort_order: "i", next_step: "s", next_step_due: "i", data: "s" },
    required: ["round_id", "firm_id", "stage"],
    softDelete: true,
    hasUpdatedAt: true,
    order: "sort_order, created_at",
    filters: ["round_id", "firm_id", "stage"],
  },
  commitments: {
    table: "commitments",
    fields: { deal_id: "s", amount: "i", currency: "s", instrument: "s", status: "s", committed_at: "i" },
    required: ["deal_id", "amount"],
    softDelete: false,
    order: "created_at",
    filters: ["deal_id"],
  },
  notes: {
    table: "notes",
    fields: { subject_type: "s", subject_id: "s", body: "s", pinned: "b", author_id: "s" },
    required: ["subject_type", "subject_id", "body"],
    softDelete: true,
    order: "created_at DESC",
    filters: ["subject_type", "subject_id"],
  },
  tasks: {
    table: "tasks",
    fields: { title: "s", assignee_id: "s", due_at: "i", status: "s",
              subject_type: "s", subject_id: "s", created_by: "s" },
    required: ["title"],
    softDelete: false,
    order: "COALESCE(due_at, 9e18), created_at",
    filters: ["status", "assignee_id", "subject_type", "subject_id"],
  },
};

// ── cross-tenant FK guard ──────────────────────────────────────────────────
// Incoming FK ids come from the request body; a caller could reference another
// org's rows. Validate every FK belongs to the caller's org before writing.
const USER_FK = new Set(["owner_user_id", "author_id", "assignee_id", "created_by"]);
const ENTITY_FK = { round_id: "rounds", firm_id: "firms", deal_id: "deals" };
const SUBJECT_TABLE = { firm: "firms", contact: "contacts", deal: "deals", round: "rounds" };
const SOFT_DELETE_TABLES = new Set(["rounds", "firms", "contacts", "deals", "notes", "folders", "files"]);

async function fkExists(env, table, id, orgId) {
  const soft = SOFT_DELETE_TABLES.has(table) ? " AND deleted_at IS NULL" : "";
  return !!(await one(env, `SELECT 1 AS x FROM ${table} WHERE id = ? AND org_id = ?${soft}`, id, orgId));
}
async function userInOrg(env, userId, orgId) {
  return !!(await one(env,
    `SELECT 1 AS x FROM memberships WHERE user_id = ? AND org_id = ? AND status = 'active'`, userId, orgId));
}
// `fields` = the already-coerced body subset. `full` carries subject_type for polymorphic checks.
async function validateFks(env, resource, fields, orgId, full) {
  for (const [f, v] of Object.entries(fields)) {
    if (v == null || v === "") continue;
    if (USER_FK.has(f)) {
      if (!await userInOrg(env, v, orgId)) throw new HttpError(400, `${f} is not a member of this workspace`);
    } else if (ENTITY_FK[f]) {
      if (!await fkExists(env, ENTITY_FK[f], v, orgId)) throw new HttpError(400, `${f} not found in this workspace`);
    } else if (f === "subject_id" && (resource === "notes" || resource === "tasks")) {
      const t = SUBJECT_TABLE[(full && full.subject_type) || fields.subject_type];
      if (t && !await fkExists(env, t, v, orgId)) throw new HttpError(400, `subject_id not found in this workspace`);
    }
  }
}

function coerce(field, type, raw) {
  if (raw === null) return null;
  if (type === "s") { const s = String(raw); const max = field === "data" ? 200000 : 8000; if (s.length > max) throw new HttpError(400, `${field} too long`); return s; }
  if (type === "i") { const n = Math.trunc(Number(raw)); if (!Number.isFinite(n)) throw new HttpError(400, `${field} must be a number`); return n; }
  if (type === "b") return raw ? 1 : 0;
  return raw;
}

function pick(body, spec) {
  const out = {};
  for (const [f, t] of Object.entries(spec.fields)) {
    if (!(f in body)) continue;
    out[f] = coerce(f, t, body[f]);
  }
  return out;
}

// resource = the segment (e.g. "deals"); rest = [] | [id] ; ctx = { orgId, role, user }
export async function handleResource(req, env, resource, rest, ctx) {
  const spec = ENTITIES[resource];
  if (!spec) throw new HttpError(404, "Unknown resource");
  const { orgId } = ctx;
  const canWrite = ctx.role !== "viewer";

  // LIST  GET /api/orgs/:orgId/<resource>?filter=...
  if (rest.length === 0 && req.method === "GET") {
    const url = new URL(req.url);
    const where = ["org_id = ?"];
    const params = [orgId];
    if (spec.softDelete) where.push("deleted_at IS NULL");
    for (const f of spec.filters) {
      const v = url.searchParams.get(f);
      if (v != null && v !== "") { where.push(`${f} = ?`); params.push(v); }
    }
    const rows = await all(env,
      `SELECT * FROM ${spec.table} WHERE ${where.join(" AND ")} ORDER BY ${spec.order}`, ...params);
    return json({ [resource]: rows });
  }

  // CREATE  POST /api/orgs/:orgId/<resource>
  if (rest.length === 0 && req.method === "POST") {
    if (!canWrite) throw new HttpError(403, "Read-only role");
    const body = await readJson(req);
    const fields = pick(body, spec);
    for (const r of spec.required) if (fields[r] == null || fields[r] === "") throw new HttpError(400, `${r} is required`);
    await validateFks(env, resource, fields, orgId, body);
    const id = newId(); const t = now();
    const row = { id, org_id: orgId, created_at: t, ...fields };
    if (spec.hasUpdatedAt) row.updated_at = t;
    // sensible server-side defaults
    if (resource === "notes" && row.author_id == null) row.author_id = ctx.user.id;
    if (resource === "tasks" && row.created_by == null) row.created_by = ctx.user.id;
    if (resource === "tasks" && row.status == null) row.status = "open";
    const cols = Object.keys(row);
    await run(env, `INSERT INTO ${spec.table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      ...cols.map(c => row[c]));
    return json({ [singular(resource)]: row }, 201);
  }

  const id = rest[0];
  if (!id) throw new HttpError(404, "Not found");

  // UPDATE  PATCH /api/orgs/:orgId/<resource>/:id
  if (rest.length === 1 && req.method === "PATCH") {
    if (!canWrite) throw new HttpError(403, "Read-only role");
    const body = await readJson(req);
    const fields = pick(body, spec);
    await validateFks(env, resource, fields, orgId, body);
    const cols = Object.keys(fields);
    if (cols.length === 0) return json({ ok: true });
    if (spec.hasUpdatedAt) { fields.updated_at = now(); cols.push("updated_at"); }
    if (resource === "tasks" && fields.status === "done") { fields.completed_at = now(); cols.push("completed_at"); }
    const set = cols.map(c => `${c} = ?`).join(", ");
    const res = await run(env, `UPDATE ${spec.table} SET ${set} WHERE id = ? AND org_id = ?`,
      ...cols.map(c => fields[c]), id, orgId);
    if (!res.meta || res.meta.changes === 0) throw new HttpError(404, "Not found");
    const updated = await one(env, `SELECT * FROM ${spec.table} WHERE id = ? AND org_id = ?`, id, orgId);
    return json({ [singular(resource)]: updated });
  }

  // DELETE  DELETE /api/orgs/:orgId/<resource>/:id
  if (rest.length === 1 && req.method === "DELETE") {
    if (!canWrite) throw new HttpError(403, "Read-only role");
    if (spec.softDelete) {
      await run(env, `UPDATE ${spec.table} SET deleted_at = ? WHERE id = ? AND org_id = ?`, now(), id, orgId);
    } else {
      await run(env, `DELETE FROM ${spec.table} WHERE id = ? AND org_id = ?`, id, orgId);
    }
    return json({ ok: true });
  }

  // Bulk reorder for kanban: POST /api/orgs/:orgId/deals/reorder  { updates:[{id,stage,sort_order}] }
  if (resource === "deals" && rest[0] === "reorder" && req.method === "POST") {
    if (!canWrite) throw new HttpError(403, "Read-only role");
    const body = await readJson(req);
    const updates = Array.isArray(body.updates) ? body.updates.slice(0, 500) : [];
    const t = now();
    for (const u of updates) {
      if (!u || !u.id) continue;
      await run(env, `UPDATE deals SET stage = COALESCE(?, stage), sort_order = COALESCE(?, sort_order), updated_at = ? WHERE id = ? AND org_id = ?`,
        u.stage ?? null, (u.sort_order ?? null), t, u.id, orgId);
    }
    return json({ ok: true, count: updates.length });
  }

  throw new HttpError(404, "Unknown route");
}

function singular(resource) {
  return { rounds: "round", firms: "firm", contacts: "contact", deals: "deal",
           commitments: "commitment", notes: "note", tasks: "task" }[resource] || resource;
}

export const RESOURCE_NAMES = Object.keys(ENTITIES);
