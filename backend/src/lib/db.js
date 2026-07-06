// db.js — thin D1 helpers + validation utilities.
import { HttpError } from "./http.js";

export function now() {
  return Math.floor(Date.now() / 1000);
}

export async function one(env, sql, ...params) {
  return env.DB.prepare(sql).bind(...params).first();
}
export async function all(env, sql, ...params) {
  const res = await env.DB.prepare(sql).bind(...params).all();
  return res.results || [];
}
export async function run(env, sql, ...params) {
  return env.DB.prepare(sql).bind(...params).run();
}

// ── validators ──
export function str(v, field, { min = 1, max = 2000, required = true } = {}) {
  if (v == null || v === "") {
    if (required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  if (typeof v !== "string") throw new HttpError(400, `${field} must be a string`);
  const s = v.trim();
  if (s.length < min) throw new HttpError(400, `${field} is too short`);
  if (s.length > max) throw new HttpError(400, `${field} is too long`);
  return s;
}

export function email(v, field = "email") {
  const s = str(v, field, { max: 320 }).toLowerCase();
  // pragmatic RFC-ish check
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) throw new HttpError(400, "Invalid email address");
  return s;
}

export function password(v) {
  if (typeof v !== "string") throw new HttpError(400, "Password is required");
  if (v.length < 10) throw new HttpError(400, "Password must be at least 10 characters");
  if (v.length > 200) throw new HttpError(400, "Password is too long");
  return v;
}
