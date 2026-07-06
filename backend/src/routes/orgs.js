// routes/orgs.js — organizations (tenants/workspaces), memberships, invites.
import { HttpError, json, readJson } from "../lib/http.js";
import { one, run, all, now, str, email as vEmail } from "../lib/db.js";
import { newId } from "../lib/crypto.js";
import { getUser, requireUser, requireOrgRole } from "../lib/auth.js";
import { issueLink, consumeToken } from "./auth.js";

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

export async function handleOrgs(req, env, parts) {
  // parts = path segments after /api/orgs
  const user = await getUser(env, req);

  // GET /api/orgs  → orgs I belong to
  if (parts.length === 0 && req.method === "GET") {
    requireUser(user);
    const orgs = await all(env,
      `SELECT o.id, o.name, o.legal_name, o.slug, o.base_currency, o.engagement_status, m.role
         FROM memberships m JOIN organizations o ON o.id = m.org_id
        WHERE m.user_id = ? AND m.status = 'active' AND o.deleted_at IS NULL
        ORDER BY o.name`, user.id);
    return json({ orgs });
  }

  // POST /api/orgs  { name, legal_name?, base_currency? }  → create; caller becomes owner
  if (parts.length === 0 && req.method === "POST") {
    requireUser(user);
    const body = await readJson(req);
    const name = str(body.name, "name", { max: 160 });
    const legal = str(body.legal_name, "legal_name", { max: 200, required: false });
    const currency = str(body.base_currency, "base_currency", { min: 3, max: 3, required: false }) || "EUR";
    const id = newId();
    let slug = slugify(name);
    if (slug && await one(env, `SELECT id FROM organizations WHERE slug = ?`, slug)) {
      slug = `${slug}-${id.slice(0, 6)}`;
    }
    await run(env,
      `INSERT INTO organizations (id, name, legal_name, slug, base_currency, engagement_status, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`,
      id, name, legal, slug || null, currency.toUpperCase(), now());
    await run(env,
      `INSERT INTO memberships (id, org_id, user_id, role, status, created_at)
       VALUES (?, ?, ?, 'owner', 'active', ?)`,
      newId(), id, user.id, now());
    return json({ org: { id, name, legal_name: legal, slug, base_currency: currency.toUpperCase(), role: "owner" } }, 201);
  }

  // POST /api/orgs/invites/accept  { token }  → join an org from an invite link
  if (parts[0] === "invites" && parts[1] === "accept" && req.method === "POST") {
    requireUser(user);
    const body = await readJson(req);
    const token = str(body.token, "token", { max: 200 });
    const rec = await consumeToken(env, token, "invite");
    if (!rec.org_id) throw new HttpError(400, "Invalid invite");
    if (rec.email.toLowerCase() !== user.email.toLowerCase())
      throw new HttpError(403, "This invite was issued to a different email");
    const existing = await one(env, `SELECT id FROM memberships WHERE org_id = ? AND user_id = ?`, rec.org_id, user.id);
    if (existing) {
      await run(env, `UPDATE memberships SET status = 'active', role = ? WHERE id = ?`, rec.role || "member", existing.id);
    } else {
      await run(env,
        `INSERT INTO memberships (id, org_id, user_id, role, status, created_at)
         VALUES (?, ?, ?, ?, 'active', ?)`,
        newId(), rec.org_id, user.id, rec.role || "member", now());
    }
    const org = await one(env, `SELECT id, name, slug, base_currency FROM organizations WHERE id = ?`, rec.org_id);
    return json({ org: { ...org, role: rec.role || "member" } });
  }

  // Routes below are scoped to a specific org: /api/orgs/:id/...
  const orgId = parts[0];
  if (!orgId) throw new HttpError(404, "Not found");

  // GET /api/orgs/:id/members
  if (parts[1] === "members" && parts.length === 2 && req.method === "GET") {
    await requireOrgRole(env, orgId, user, "viewer");
    const members = await all(env,
      `SELECT u.id, u.email, u.name, m.role, m.status, m.created_at
         FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.org_id = ? ORDER BY m.created_at`, orgId);
    return json({ members });
  }

  // POST /api/orgs/:id/invites  { email, role }  → admin+ invites someone
  if (parts[1] === "invites" && parts.length === 2 && req.method === "POST") {
    await requireOrgRole(env, orgId, user, "admin");
    const body = await readJson(req);
    const email = vEmail(body.email);
    const role = str(body.role, "role", { max: 20, required: false }) || "member";
    if (!["admin", "operator", "member", "viewer"].includes(role))
      throw new HttpError(400, "Invalid role");
    await issueLink(env, email, "invite", { org_id: orgId, role });
    return json({ ok: true });
  }

  // PATCH /api/orgs/:id/members/:userId  { role }  → change a member's role (admin+)
  if (parts[1] === "members" && parts.length === 3 && req.method === "PATCH") {
    const actorRole = await requireOrgRole(env, orgId, user, "admin");
    const targetId = parts[2];
    const body = await readJson(req);
    const role = str(body.role, "role", { max: 20 });
    if (!["owner", "admin", "operator", "member", "viewer"].includes(role))
      throw new HttpError(400, "Invalid role");
    if (role === "owner" && actorRole !== "owner") throw new HttpError(403, "Only an owner can grant ownership");
    await run(env, `UPDATE memberships SET role = ? WHERE org_id = ? AND user_id = ?`, role, orgId, targetId);
    return json({ ok: true });
  }

  // DELETE /api/orgs/:id/members/:userId  → remove access (this is how Evolute churn works)
  if (parts[1] === "members" && parts.length === 3 && req.method === "DELETE") {
    await requireOrgRole(env, orgId, user, "admin");
    const targetId = parts[2];
    // Never remove the last owner.
    const owners = await all(env, `SELECT user_id FROM memberships WHERE org_id = ? AND role = 'owner' AND status = 'active'`, orgId);
    if (owners.length <= 1 && owners.some(o => o.user_id === targetId))
      throw new HttpError(400, "Cannot remove the last owner");
    await run(env, `DELETE FROM memberships WHERE org_id = ? AND user_id = ?`, orgId, targetId);
    return json({ ok: true });
  }

  // PATCH /api/orgs/:id  { engagement_status?, name?, ... }  (owner/admin)
  if (parts.length === 1 && req.method === "PATCH") {
    await requireOrgRole(env, orgId, user, "admin");
    const body = await readJson(req);
    if (body.engagement_status && !["active", "churned", "none"].includes(body.engagement_status))
      throw new HttpError(400, "Invalid engagement_status");
    const name = body.name != null ? str(body.name, "name", { max: 160 }) : null;
    await run(env,
      `UPDATE organizations SET
         name = COALESCE(?, name),
         engagement_status = COALESCE(?, engagement_status)
       WHERE id = ?`, name, body.engagement_status || null, orgId);
    return json({ ok: true });
  }

  throw new HttpError(404, "Unknown org route");
}
