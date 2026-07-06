// auth.js — sessions, current-user resolution, and role-based authorization.
import { HttpError, readSessionToken } from "./http.js";
import { one, run, now } from "./db.js";
import { randomToken, sha256hex, newId } from "./crypto.js";

const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days

// Create a session; returns { token, maxAge }. Store only the token's hash.
export async function createSession(env, userId, req) {
  const token = randomToken(32);
  const token_hash = await sha256hex(token);
  const t = now();
  await run(env,
    `INSERT INTO sessions (token_hash, id, user_id, created_at, expires_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    token_hash, newId(), userId, t, t + SESSION_TTL,
    (req.headers.get("user-agent") || "").slice(0, 300),
    req.headers.get("cf-connecting-ip") || null
  );
  return { token, maxAge: SESSION_TTL };
}

// Resolve the logged-in user from the session cookie, or null.
export async function getUser(env, req) {
  const token = readSessionToken(req);
  if (!token) return null;
  const token_hash = await sha256hex(token);
  const row = await one(env,
    `SELECT s.expires_at, u.id, u.email, u.name, u.avatar_url, u.email_verified
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`, token_hash);
  if (!row) return null;
  if (row.expires_at < now()) {
    await run(env, `DELETE FROM sessions WHERE token_hash = ?`, token_hash);
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, avatar_url: row.avatar_url, email_verified: row.email_verified };
}

export async function destroySession(env, req) {
  const token = readSessionToken(req);
  if (!token) return;
  await run(env, `DELETE FROM sessions WHERE token_hash = ?`, await sha256hex(token));
}

export function requireUser(user) {
  if (!user) throw new HttpError(401, "Not signed in");
  return user;
}

// Role hierarchy — higher number = more power.
const RANK = { viewer: 1, member: 2, operator: 3, admin: 4, owner: 5 };

export async function getMembership(env, orgId, userId) {
  return one(env,
    `SELECT role, status FROM memberships WHERE org_id = ? AND user_id = ?`, orgId, userId);
}

// Require the user to be a member of org with at least `minRole`. Returns the role.
export async function requireOrgRole(env, orgId, user, minRole = "viewer") {
  requireUser(user);
  const m = await getMembership(env, orgId, user.id);
  if (!m || m.status !== "active") throw new HttpError(403, "No access to this workspace");
  if ((RANK[m.role] || 0) < (RANK[minRole] || 99)) throw new HttpError(403, "Insufficient role");
  return m.role;
}

export { SESSION_TTL };
