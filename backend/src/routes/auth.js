// routes/auth.js — signup, login, logout, me, magic links, password reset.
import { HttpError, json, readJson, sessionCookie, clearSessionCookie } from "../lib/http.js";
import { one, run, all, now, email as vEmail, password as vPassword, str } from "../lib/db.js";
import { hashPassword, verifyPassword, newId, randomToken, sha256hex } from "../lib/crypto.js";
import { createSession, destroySession, getUser, SESSION_TTL } from "../lib/auth.js";
import { sendEmail, linkEmail } from "../lib/email.js";

const TOKEN_TTL = 60 * 30; // 30 min for magic/reset/invite links

// ── rate limiting via KV: max attempts per key within a window ──
async function rateLimit(env, key, max, windowSec) {
  if (!env.RATE) return; // KV optional in dev
  const k = `rl:${key}`;
  const cur = parseInt((await env.RATE.get(k)) || "0", 10);
  if (cur >= max) throw new HttpError(429, "Too many attempts. Try again later.");
  await env.RATE.put(k, String(cur + 1), { expirationTtl: windowSec });
}
async function clearRate(env, key) {
  if (env.RATE) await env.RATE.delete(`rl:${key}`);
}

function setCookie(token) {
  return { "set-cookie": sessionCookie(token, SESSION_TTL) };
}

export async function handleAuth(req, env, sub) {
  // POST /api/auth/signup  { email, name, password }
  if (sub === "signup" && req.method === "POST") {
    const ip = req.headers.get("cf-connecting-ip") || "unknown";
    await rateLimit(env, `signup:${ip}`, 10, 3600); // 10 new accounts / hour / IP
    const body = await readJson(req);
    const email = vEmail(body.email);
    const name = str(body.name, "name", { max: 120, required: false });
    const pw = vPassword(body.password);
    const existing = await one(env, `SELECT id FROM users WHERE email = ?`, email);
    if (existing) throw new HttpError(409, "An account with that email already exists");
    const id = newId();
    await run(env,
      `INSERT INTO users (id, email, name, password_hash, email_verified, created_at, last_login_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
      id, email, name, await hashPassword(pw, env.SESSION_PEPPER), now(), now());
    // Give every new user a personal workspace (org + owner membership) so the app
    // always has an org to read/write. Without this, orgs=[] and Acquire stays local-only.
    await createDefaultOrg(env, id, name, email);
    const { token } = await createSession(env, id, req);
    return json({ user: { id, email, name } }, 201, setCookie(token));
  }

  // POST /api/auth/login  { email, password }
  if (sub === "login" && req.method === "POST") {
    const body = await readJson(req);
    const email = vEmail(body.email);
    await rateLimit(env, `login:${email}`, 8, 900); // 8 tries / 15 min
    const ip = req.headers.get("cf-connecting-ip") || "unknown";
    await rateLimit(env, `loginip:${ip}`, 30, 900);
    const u = await one(env, `SELECT id, password_hash, name FROM users WHERE email = ?`, email);
    const ok = u && await verifyPassword(body.password || "", u.password_hash, env.SESSION_PEPPER);
    if (!ok) throw new HttpError(401, "Incorrect email or password"); // same message either way
    await clearRate(env, `login:${email}`);
    await run(env, `UPDATE users SET last_login_at = ? WHERE id = ?`, now(), u.id);
    const { token } = await createSession(env, u.id, req);
    return json({ user: { id: u.id, email, name: u.name } }, 200, setCookie(token));
  }

  // POST /api/auth/logout
  if (sub === "logout" && req.method === "POST") {
    await destroySession(env, req);
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  }

  // GET /api/auth/me  → user + their orgs
  if (sub === "me" && req.method === "GET") {
    const user = await getUser(env, req);
    if (!user) return json({ user: null });
    const orgs = await all(env,
      `SELECT o.id, o.name, o.slug, o.base_currency, m.role
         FROM memberships m JOIN organizations o ON o.id = m.org_id
        WHERE m.user_id = ? AND m.status = 'active' AND o.deleted_at IS NULL
        ORDER BY o.name`, user.id);
    return json({ user, orgs });
  }

  // POST /api/auth/magic/request  { email }  → email a one-time sign-in link
  if (sub === "magic/request" && req.method === "POST") {
    const body = await readJson(req);
    const email = vEmail(body.email);
    await rateLimit(env, `magic:${email}`, 5, 900);
    const u = await one(env, `SELECT id FROM users WHERE email = ?`, email);
    // Always respond ok (don't reveal whether the account exists).
    if (u) await issueLink(env, email, "magic_link");
    return json({ ok: true });
  }

  // POST /api/auth/magic/consume  { token }  → sign in
  if (sub === "magic/consume" && req.method === "POST") {
    const body = await readJson(req);
    const token = str(body.token, "token", { max: 200 });
    const rec = await consumeToken(env, token, "magic_link");
    const u = await one(env, `SELECT id, email, name FROM users WHERE email = ?`, rec.email);
    if (!u) throw new HttpError(400, "Invalid link");
    await run(env, `UPDATE users SET email_verified = 1, last_login_at = ? WHERE id = ?`, now(), u.id);
    const { token: sess } = await createSession(env, u.id, req);
    return json({ user: { id: u.id, email: u.email, name: u.name } }, 200, setCookie(sess));
  }

  // POST /api/auth/password/request  { email }
  if (sub === "password/request" && req.method === "POST") {
    const body = await readJson(req);
    const email = vEmail(body.email);
    await rateLimit(env, `pwreset:${email}`, 5, 900);
    const u = await one(env, `SELECT id FROM users WHERE email = ?`, email);
    if (u) await issueLink(env, email, "password_reset");
    return json({ ok: true });
  }

  // POST /api/auth/password/reset  { token, password }
  if (sub === "password/reset" && req.method === "POST") {
    const body = await readJson(req);
    const token = str(body.token, "token", { max: 200 });
    const pw = vPassword(body.password);
    const rec = await consumeToken(env, token, "password_reset");
    const u = await one(env, `SELECT id FROM users WHERE email = ?`, rec.email);
    if (!u) throw new HttpError(400, "Invalid link");
    await run(env, `UPDATE users SET password_hash = ? WHERE id = ?`,
      await hashPassword(pw, env.SESSION_PEPPER), u.id);
    // Invalidate all existing sessions on password change.
    await run(env, `DELETE FROM sessions WHERE user_id = ?`, u.id);
    return json({ ok: true });
  }

  throw new HttpError(404, "Unknown auth route");
}

// ── helpers ──
// Create a personal workspace for a user and make them its owner.
async function createDefaultOrg(env, userId, name, email) {
  const orgId = newId();
  const orgName = (name && name.trim()) ? `${name.trim()}'s workspace` : `${email.split("@")[0]}'s workspace`;
  let slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  if (slug && await one(env, `SELECT id FROM organizations WHERE slug = ?`, slug)) slug = `${slug}-${orgId.slice(0, 6)}`;
  await run(env,
    `INSERT INTO organizations (id, name, slug, base_currency, engagement_status, created_at)
     VALUES (?, ?, ?, 'EUR', 'active', ?)`, orgId, orgName, slug || null, now());
  await run(env,
    `INSERT INTO memberships (id, org_id, user_id, role, status, created_at)
     VALUES (?, ?, ?, 'owner', 'active', ?)`, newId(), orgId, userId, now());
  return orgId;
}

async function issueLink(env, email, purpose, extra = {}) {
  const raw = randomToken(32);
  await run(env,
    `INSERT INTO login_tokens (token_hash, email, purpose, org_id, role, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    await sha256hex(raw), email, purpose, extra.org_id || null, extra.role || null,
    now(), now() + TOKEN_TTL);
  const url = `${env.APP_ORIGIN}/#${purpose}=${raw}`;
  const { text, html } = linkEmail(purpose, url);
  await sendEmail(env, { to: email, subject: qSubject(purpose), text, html });
  return raw;
}

function qSubject(purpose) {
  return purpose === "invite" ? "You've been invited to a Q. OS workspace"
    : purpose === "password_reset" ? "Reset your Q. OS password"
    : "Your Q. OS sign-in link";
}

async function consumeToken(env, raw, purpose) {
  const hash = await sha256hex(raw);
  const rec = await one(env,
    `SELECT token_hash, email, purpose, org_id, role, expires_at, used_at
       FROM login_tokens WHERE token_hash = ?`, hash);
  if (!rec || rec.purpose !== purpose) throw new HttpError(400, "Invalid or expired link");
  if (rec.used_at) throw new HttpError(400, "This link has already been used");
  if (rec.expires_at < now()) throw new HttpError(400, "This link has expired");
  await run(env, `UPDATE login_tokens SET used_at = ? WHERE token_hash = ?`, now(), hash);
  return rec;
}

export { issueLink, consumeToken, TOKEN_TTL, rateLimit };
