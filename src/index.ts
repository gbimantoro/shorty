import type { Env, LinkRecord, CreateLinkPayload } from "./types";
import {
  validateTargetUrl,
  validateSlug,
  generateSlug,
  verifyAuth,
  checkRateLimit,
  addSecurityHeaders
} from "./security";
import { renderHtml } from "./html";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const response = await handleRequest(request, env, ctx);
      return addSecurityHeaders(response);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Internal Server Error";
      return addSecurityHeaders(
        new Response(JSON.stringify({ success: false, error: message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        })
      );
    }
  }
};

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const path = url.pathname;

  // Handle CORS Preflight
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
        "Access-Control-Max-Age": "86400"
      }
    });
  }

  // Method restriction
  if (!["GET", "POST", "DELETE", "HEAD"].includes(method)) {
    return new Response(JSON.stringify({ success: false, error: `Method ${method} not allowed` }), {
      status: 405,
      headers: { "Content-Type": "application/json", Allow: "GET, POST, DELETE, HEAD, OPTIONS" }
    });
  }

  // 1. Root / UI
  if (path === "/" || path === "") {
    if (method !== "GET" && method !== "HEAD") {
      return jsonError("Method not allowed", 405);
    }
    const accept = request.headers.get("Accept") || "";
    if (accept.includes("application/json") && !accept.includes("text/html")) {
      return jsonResponse({
        success: true,
        data: {
          app: env.APP_NAME || "Shorty",
          status: "online",
          version: "1.0.0",
          endpoints: {
            shorten: "POST /api/shorten",
            stats: "GET /api/stats/:slug",
            delete: "DELETE /api/links/:slug",
            health: "GET /health"
          }
        }
      });
    }
    return new Response(renderHtml(env.APP_NAME || "Shorty"), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=3600"
      }
    });
  }

  // 2. Health check
  if (path === "/health") {
    return jsonResponse({
      status: "ok",
      timestamp: Date.now(),
      app: env.APP_NAME || "Shorty"
    });
  }

  // 3. Robots.txt — Prevent scrapers from crawling redirect paths
  if (path === "/robots.txt") {
    return new Response("User-agent: *\nDisallow: /\n", {
      status: 200,
      headers: { "Content-Type": "text/plain", "Cache-Control": "public, max-age=86400" }
    });
  }

  // 4. API: Create / Shorten Link
  if (path === "/api/shorten" || path === "/api/links") {
    if (method !== "POST") return jsonError("Method not allowed", 405);

    // Rate limiting per IP
    const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
    const rateLimit = parseInt(env.RATE_LIMIT_PER_MINUTE || "60", 10);
    const rlCheck = checkRateLimit(clientIp, rateLimit);
    if (!rlCheck.allowed) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Rate limit exceeded. Please wait before shortening more links."
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(rlCheck.reset - Math.ceil(Date.now() / 1000))
          }
        }
      );
    }

    // Auth verification
    const isAuthorized = await verifyAuth(request, env.API_KEY);
    if (!isAuthorized) {
      return jsonError("Unauthorized: Valid API key required.", 401);
    }

    // Body parsing with size cap
    const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
    if (contentLength > 16384) {
      return jsonError("Payload too large. Max 16 KB.", 413);
    }

    let payload: CreateLinkPayload;
    try {
      payload = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    // Target URL validation
    const targetValidation = validateTargetUrl(payload.url);
    if (!targetValidation.ok) {
      return jsonError(targetValidation.error, 400);
    }

    // Slug validation or generation
    let finalSlug: string;
    if (payload.slug && payload.slug.trim()) {
      const slugValidation = validateSlug(payload.slug);
      if (!slugValidation.ok) {
        return jsonError(slugValidation.error, 400);
      }
      finalSlug = slugValidation.slug;

      // Check if custom slug already exists
      const existing = await env.SHORTY_KV.get(`link:${finalSlug}`);
      if (existing) {
        return jsonError(`Slug "${finalSlug}" is already taken.`, 409);
      }
    } else {
      // Auto-generate unique slug
      let generated = generateSlug(6);
      let attempts = 0;
      while (attempts < 5) {
        const collision = await env.SHORTY_KV.get(`link:${generated}`);
        if (!collision) break;
        generated = generateSlug(6);
        attempts++;
      }
      finalSlug = generated;
    }

    // Handle Expiration TTL
    let expiresAt: number | null = null;
    let kvTtlSeconds: number | undefined = undefined;
    if (payload.expiresIn && typeof payload.expiresIn === "number" && payload.expiresIn > 0) {
      const minTtl = 60; // Cloudflare KV min TTL is 60s
      const maxTtl = 10 * 365 * 86400; // 10 years
      const clampedTtl = Math.min(Math.max(payload.expiresIn, minTtl), maxTtl);
      expiresAt = Date.now() + clampedTtl * 1000;
      kvTtlSeconds = clampedTtl;
    }

    // Redirect status (301, 302, 307, 308)
    const defaultStatus = parseInt(env.DEFAULT_REDIRECT_CODE || "302", 10);
    const validStatuses = [301, 302, 307, 308];
    const status = payload.status && validStatuses.includes(payload.status) ? payload.status : defaultStatus;

    const record: LinkRecord = {
      slug: finalSlug,
      target: targetValidation.url,
      createdAt: Date.now(),
      expiresAt,
      status,
      clicks: 0,
      lastClickedAt: null
    };

    // Store in Cloudflare KV
    await env.SHORTY_KV.put(`link:${finalSlug}`, JSON.stringify(record), {
      expirationTtl: kvTtlSeconds
    });

    const shortUrl = `${url.origin}/${finalSlug}`;

    return jsonResponse(
      {
        success: true,
        data: {
          slug: finalSlug,
          shortUrl,
          target: record.target,
          status: record.status,
          createdAt: record.createdAt,
          expiresAt: record.expiresAt
        }
      },
      201
    );
  }

  // 5. API: Get Link Stats
  if (path.startsWith("/api/stats/")) {
    if (method !== "GET") return jsonError("Method not allowed", 405);

    const slug = path.replace("/api/stats/", "").trim();
    const slugCheck = validateSlug(slug);
    if (!slugCheck.ok) return jsonError(slugCheck.error, 400);

    const recordRaw = await env.SHORTY_KV.get(`link:${slugCheck.slug}`);
    if (!recordRaw) return jsonError("Link not found", 404);

    const record: LinkRecord = JSON.parse(recordRaw);
    return jsonResponse({
      success: true,
      data: record
    });
  }

  // 6. API: Delete Link
  if (path.startsWith("/api/links/")) {
    if (method !== "DELETE") return jsonError("Method not allowed", 405);

    const isAuthorized = await verifyAuth(request, env.API_KEY);
    if (!isAuthorized) return jsonError("Unauthorized", 401);

    const slug = path.replace("/api/links/", "").trim();
    const slugCheck = validateSlug(slug);
    if (!slugCheck.ok) return jsonError(slugCheck.error, 400);

    const record = await env.SHORTY_KV.get(`link:${slugCheck.slug}`);
    if (!record) return jsonError("Link not found", 404);

    await env.SHORTY_KV.delete(`link:${slugCheck.slug}`);
    return jsonResponse({ success: true, message: `Link "${slugCheck.slug}" deleted.` });
  }

  // 7. Short URL Redirection: /:slug
  const candidateSlug = path.slice(1);
  const slugValidation = validateSlug(candidateSlug);
  if (!slugValidation.ok) {
    return renderNotFound(candidateSlug);
  }

  // Fast sub-millisecond edge KV read
  const recordRaw = await env.SHORTY_KV.get(`link:${slugValidation.slug}`);
  if (!recordRaw) {
    return renderNotFound(slugValidation.slug);
  }

  const record: LinkRecord = JSON.parse(recordRaw);

  // Check TTL expiration
  if (record.expiresAt && record.expiresAt < Date.now()) {
    // Delete expired record in background
    ctx.waitUntil(env.SHORTY_KV.delete(`link:${slugValidation.slug}`));
    return new Response("This short link has expired.", {
      status: 410,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }

  // Non-blocking asynchronous click tracking
  ctx.waitUntil(trackClick(env.SHORTY_KV, slugValidation.slug, record));

  // High-performance edge redirect
  return new Response(null, {
    status: record.status || 302,
    headers: {
      Location: record.target,
      // Edge cache allows subsequent redirects to resolve at the edge in < 5ms
      "Cache-Control": "public, max-age=60, s-maxage=300",
      "X-Robots-Tag": "noindex, nofollow"
    }
  });
}

/**
 * Asynchronous click count updater without blocking redirect execution.
 */
async function trackClick(kv: KVNamespace, slug: string, cachedRecord: LinkRecord): Promise<void> {
  try {
    const key = `link:${slug}`;
    cachedRecord.clicks = (cachedRecord.clicks || 0) + 1;
    cachedRecord.lastClickedAt = Date.now();

    const options: { expirationTtl?: number } = {};
    if (cachedRecord.expiresAt) {
      const remainingSec = Math.max(60, Math.floor((cachedRecord.expiresAt - Date.now()) / 1000));
      options.expirationTtl = remainingSec;
    }

    await kv.put(key, JSON.stringify(cachedRecord), options);
  } catch {
    // Non-fatal background task
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

function jsonError(message: string, status = 400): Response {
  return jsonResponse({ success: false, error: message }, status);
}

function renderNotFound(slug: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>404 · Link Not Found</title>
  <style>
    body { background: #090a0f; color: #e6edf3; font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .box { text-align: center; max-width: 420px; padding: 2rem; border: 1px solid #232938; border-radius: 12px; background: #12151e; }
    h1 { font-size: 3rem; margin-bottom: 0.5rem; color: #ef4444; }
    p { color: #8b949e; margin-bottom: 1.5rem; line-height: 1.5; font-size: 0.95rem; }
    code { font-family: monospace; color: #10b981; }
    a { display: inline-block; background: #10b981; color: #000; padding: 0.6rem 1.2rem; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="box">
    <h1>404</h1>
    <p>Short link <code>/${slug}</code> was not found or has been removed.</p>
    <a href="/">Go to Shorty Home</a>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}
