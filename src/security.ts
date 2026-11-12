const BASE62_CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

const RESERVED_SLUGS = new Set([
  "api",
  "stats",
  "health",
  "robots.txt",
  "favicon.ico",
  "assets",
  "admin",
  "login",
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
    return true; // No key configured, open mode
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
