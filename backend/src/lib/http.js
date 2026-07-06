// http.js — request/response helpers, cookies, CSRF origin check, error type.

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || null;
  }
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

export async function readJson(req, maxBytes = 1_000_000) {
  const len = req.headers.get("content-length");
  if (len && parseInt(len, 10) > maxBytes) throw new HttpError(413, "Payload too large");
  let body;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  if (body === null || typeof body !== "object") throw new HttpError(400, "Body must be an object");
  return body;
}

// Reject cross-site state-changing requests. Cookies are SameSite, but we also
// require the Origin header to match our own origin on all mutations (defense in depth).
export function assertSameOrigin(req, env) {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const origin = req.headers.get("origin");
  const allowed = env.APP_ORIGIN;
  if (!origin || !allowed || origin !== allowed) {
    throw new HttpError(403, "Cross-origin request refused");
  }
}

const COOKIE = "q_session";

export function sessionCookie(token, maxAgeSeconds) {
  const attrs = [
    `${COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  return attrs.join("; ");
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readSessionToken(req) {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) === COOKIE) return part.slice(eq + 1);
  }
  return null;
}
