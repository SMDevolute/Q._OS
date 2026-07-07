// crypto.js — password hashing, token generation, constant-time compare.
// Uses only WebCrypto (available in Workers). No external deps.

const ITERATIONS = 100000;          // Cloudflare Workers' WebCrypto caps PBKDF2 at 100k iterations (higher throws NotSupportedError). This is the supported max.
const SALT_BYTES = 16;
const HASH_BITS = 256;

const enc = new TextEncoder();

function b64(bytes) {
  let s = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}
function unb64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64url(bytes) {
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// A cryptographically-random URL-safe token (default 32 bytes = 256 bits).
export function randomToken(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return b64url(buf);
}

export function newId() {
  return crypto.randomUUID();
}

// SHA-256 → hex. Used to store only the HASH of session/login tokens.
export async function sha256hex(input) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  const arr = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, "0");
  return hex;
}

// Constant-time string comparison (prevents timing attacks on token/hash checks).
export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" }, keyMaterial, HASH_BITS
  );
  return new Uint8Array(bits);
}

// Hash a password. `pepper` is a server-side secret (env.SESSION_PEPPER) mixed in,
// so a leaked DB alone is not enough to crack hashes offline.
// Stored format: pbkdf2$<iterations>$<saltB64>$<hashB64>
export async function hashPassword(password, pepper) {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const hash = await pbkdf2(pepper + password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password, stored, pepper) {
  if (!stored || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  const salt = unb64(parts[2]);
  const expected = parts[3];
  const hash = await pbkdf2(pepper + password, salt, iterations);
  return timingSafeEqual(b64(hash), expected);
}
