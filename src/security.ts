import type { Env, SessionPayload } from "./types";

const BASE62_CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const SESSION_COOKIE_NAME = "shorty_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

const RESERVED_SLUGS = new Set([
  "api",
  "stats",
  "health",
  "robots.txt",
  "favicon.ico",
  "assets",
  "admin",
  "login",
  "logout",
  "static",
  "_next",
  "shorten",
  "dashboard",
  "metrics",
  "ping",
  "s",
  "u",
  "url",
  "link"
]);

/**
 * Validates target URL against SSRF, dangerous protocols, and private networks.
 */
export function validateTargetUrl(rawUrl: unknown): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return { ok: false, error: "Target URL is required." };
  }

  const trimmed = rawUrl.trim();
  if (trimmed.length > 2048) {
    return { ok: false, error: "URL is too long (maximum 2048 characters)." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Invalid URL format." };
  }

  // Enforce HTTP / HTTPS protocols ONLY
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Only http:// and https:// URLs are allowed." };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost and standard private/internal TLDs
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".test") ||
    hostname.endsWith(".example") ||
    hostname.endsWith(".invalid")
  ) {
    return { ok: false, error: "Private or internal hostnames are prohibited." };
  }

  // Disallow userinfo (e.g. https://user:pass@example.com) for safety
  if (parsed.username || parsed.password) {
    return { ok: false, error: "Credentials in URL are not allowed." };
  }

  // SSRF protection: Check IPv4 / IPv6 addresses
  if (isPrivateIp(hostname)) {
    return { ok: false, error: "Private and local network addresses are prohibited." };
  }

  return { ok: true, url: parsed.toString() };
}

/**
 * Validates slug syntax and reserved keywords.
 */
export function validateSlug(slug: unknown): { ok: true; slug: string } | { ok: false; error: string } {
  if (typeof slug !== "string" || !slug.trim()) {
    return { ok: false, error: "Slug cannot be empty." };
  }

  const cleaned = slug.trim();

  if (cleaned.length < 1 || cleaned.length > 64) {
    return { ok: false, error: "Slug length must be between 1 and 64 characters." };
  }

  // Strict regex: letters, numbers, hyphens, underscores only
  if (!/^[a-zA-Z0-9_-]+$/.test(cleaned)) {
    return { ok: false, error: "Slug may only contain alphanumeric characters, hyphens, and underscores." };
  }

  if (RESERVED_SLUGS.has(cleaned.toLowerCase())) {
    return { ok: false, error: `Slug "${cleaned}" is a reserved system path.` };
  }

  return { ok: true, slug: cleaned };
}

/**
 * Cryptographically secure slug generator using Base62.
 */
export function generateSlug(length = 6): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let slug = "";
  for (let i = 0; i < length; i++) {
    slug += BASE62_CHARS[bytes[i] % BASE62_CHARS.length];
  }
  return slug;
}

/**
 * Constant-time comparison using SHA-256 digest to prevent timing attacks.
 */
export async function timingSafeCompare(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const hashA = await crypto.subtle.digest("SHA-256", enc.encode(a));
  const hashB = await crypto.subtle.digest("SHA-256", enc.encode(b));
  const u8A = new Uint8Array(hashA);
  const u8B = new Uint8Array(hashB);

  let diff = 0;
  for (let i = 0; i < u8A.length; i++) {
    diff |= u8A[i] ^ u8B[i];
  }
  return diff === 0;
}

/**
 * Verify API Key via Authorization Bearer or X-API-Key header.
 */
export async function verifyAuth(request: Request, configuredApiKey?: string): Promise<boolean> {
  if (!configuredApiKey || configuredApiKey.trim() === "") {
    return false;
  }

  const authHeader = request.headers.get("Authorization");
  let token = "";
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  } else {
    token = request.headers.get("X-API-Key")?.trim() || "";
  }

  if (!token) return false;
  return timingSafeCompare(token, configuredApiKey.trim());
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array | null {
  try {
    const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/**
 * Signs a stateless HMAC-SHA256 session token.
 */
export async function signSessionToken(
  username: string,
  secret: string,
  ttlSeconds = SESSION_TTL_SECONDS
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jtiBytes = new Uint8Array(12);
  crypto.getRandomValues(jtiBytes);

  const payload: SessionPayload = {
    sub: username,
    iat: now,
    exp: now + ttlSeconds,
    jti: base64UrlEncode(jtiBytes)
  };

  const enc = new TextEncoder();
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const key = await getHmacKey(secret);
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64));
  const sigB64 = base64UrlEncode(new Uint8Array(sigBuf));

  return `${payloadB64}.${sigB64}`;
}

/**
 * Verifies an HMAC-SHA256 session token and returns payload if valid and unexpired.
 */
export async function verifySessionToken(token: string, secret: string): Promise<SessionPayload | null> {
  if (!token || !secret || secret.trim().length < 16) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, sigB64] = parts;
  const sigBytes = base64UrlDecode(sigB64);
  if (!sigBytes) return null;

  const enc = new TextEncoder();
  const key = await getHmacKey(secret);
  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(payloadB64));
  if (!valid) return null;

  const payloadBytes = base64UrlDecode(payloadB64);
  if (!payloadBytes) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as SessionPayload;
    const now = Math.floor(Date.now() / 1000);
    if (!payload.sub || typeof payload.exp !== "number" || payload.exp <= now) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Parses Cookie header into a key-value map.
 */
export function parseCookies(cookieHeader: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  }
  return cookies;
}

/**
 * Verifies request authentication via either valid session cookie or API key.
 * Fail-closed: returns null if not authenticated.
 */
export async function verifyRequestAuth(
  request: Request,
  env: Pick<Env, "SESSION_SECRET" | "API_KEY">
): Promise<{ authenticated: true; method: "session" | "api_key"; username: string } | null> {
  // 1. Check HttpOnly session cookie
  if (env.SESSION_SECRET && env.SESSION_SECRET.trim().length >= 16) {
    const cookies = parseCookies(request.headers.get("Cookie"));
    const token = cookies[SESSION_COOKIE_NAME];
    if (token) {
      const session = await verifySessionToken(token, env.SESSION_SECRET);
      if (session) {
        return { authenticated: true, method: "session", username: session.sub };
      }
    }
  }

  // 2. Check API Key header (Bearer or X-API-Key)
  if (await verifyAuth(request, env.API_KEY)) {
    return { authenticated: true, method: "api_key", username: "api-key" };
  }

  return null;
}

/**
 * Builds Set-Cookie header for shorty_session.
 */
export function buildSessionCookie(token: string, isHttps: boolean, maxAge = SESSION_TTL_SECONDS): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`
  ];
  if (isHttps) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

/**
 * In-memory sliding window rate limiter per client IP.
 */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(clientIp: string, limitPerMinute = 60): { allowed: boolean; remaining: number; reset: number } {
  const now = Date.now();
  const windowMs = 60_000;
  const record = rateLimitMap.get(clientIp);

  // Clean old entries opportunistically
  if (rateLimitMap.size > 2000) {
    for (const [key, val] of rateLimitMap.entries()) {
      if (val.resetAt < now) rateLimitMap.delete(key);
    }
  }

  if (!record || record.resetAt < now) {
    rateLimitMap.set(clientIp, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limitPerMinute - 1, reset: Math.ceil((now + windowMs) / 1000) };
  }

  if (record.count >= limitPerMinute) {
    return { allowed: false, remaining: 0, reset: Math.ceil(record.resetAt / 1000) };
  }

  record.count += 1;
  return { allowed: true, remaining: limitPerMinute - record.count, reset: Math.ceil(record.resetAt / 1000) };
}

/**
 * Brute-force protection for login: 5 failed attempts in 60s -> 300s lock.
 */
const loginThrottleMap = new Map<string, { fails: number; windowStart: number; lockedUntil: number }>();

export function checkLoginThrottle(key: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const entry = loginThrottleMap.get(key);
  if (!entry) return { allowed: true, retryAfter: 0 };

  if (entry.lockedUntil > now) {
    return { allowed: false, retryAfter: Math.ceil((entry.lockedUntil - now) / 1000) };
  }

  if (now - entry.windowStart > 60_000) {
    loginThrottleMap.delete(key);
  }
  return { allowed: true, retryAfter: 0 };
}

export function recordLoginFailure(key: string): { locked: boolean; retryAfter: number } {
  const now = Date.now();
  if (loginThrottleMap.size > 2000) {
    for (const [k, v] of loginThrottleMap.entries()) {
      if (v.lockedUntil < now && now - v.windowStart > 60_000) {
        loginThrottleMap.delete(k);
      }
    }
  }

  const entry = loginThrottleMap.get(key);
  if (!entry || now - entry.windowStart > 60_000) {
    loginThrottleMap.set(key, { fails: 1, windowStart: now, lockedUntil: 0 });
    return { locked: false, retryAfter: 0 };
  }

  entry.fails += 1;
  if (entry.fails >= 5) {
    entry.lockedUntil = now + 300_000; // 5-minute lock
    return { locked: true, retryAfter: 300 };
  }
  return { locked: false, retryAfter: 0 };
}

export function clearLoginThrottle(key: string): void {
  loginThrottleMap.delete(key);
}

/**
 * Attach defense-in-depth security headers to any outgoing Response.
 */
export function addSecurityHeaders(response: Response, isRedirect = false): Response {
  const newHeaders = new Headers(response.headers);

  newHeaders.set("X-Content-Type-Options", "nosniff");
  newHeaders.set("X-Frame-Options", "DENY");
  newHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");
  newHeaders.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  newHeaders.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'"
  );
  newHeaders.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");
  newHeaders.set("Cross-Origin-Resource-Policy", "same-origin");

  if (isRedirect) {
    newHeaders.set("X-Robots-Tag", "noindex, nofollow");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}

/**
 * Checks if a hostname resolves to a private or loopback IP.
 */
function isPrivateIp(host: string): boolean {
  // Strip IPv6 enclosing brackets if present
  let clean = host;
  if (clean.startsWith("[") && clean.endsWith("]")) {
    clean = clean.slice(1, -1);
  }

  // IPv6 checks
  if (clean.includes(":")) {
    if (clean === "::1" || clean === "::") return true;
    const lower = clean.toLowerCase();
    if (lower.startsWith("fe80:") || lower.startsWith("fc00:") || lower.startsWith("fd00:")) return true;
    return false;
  }

  // IPv4 dotted-decimal check
  const parts = clean.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    const [b0, b1, b2, b3] = parts.map(Number);
    if ([b0, b1, b2, b3].some((b) => b < 0 || b > 255)) return true;

    // 0.0.0.0/8
    if (b0 === 0) return true;
    // 127.0.0.0/8 (Loopback)
    if (b0 === 127) return true;
    // 10.0.0.0/8 (Private)
    if (b0 === 10) return true;
    // 172.16.0.0/12 (Private)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    // 192.168.0.0/16 (Private)
    if (b0 === 192 && b1 === 168) return true;
    // 169.254.0.0/16 (Link-local)
    if (b0 === 169 && b1 === 254) return true;
    // 224.0.0.0/4 (Multicast)
    if (b0 >= 224) return true;
  }

  // Block numeric IP representations (e.g. 2130706433 or 0x7f000001)
  if (/^(0x[0-9a-fA-F]+|\d+)$/.test(clean)) {
    return true;
  }

  return false;
}
