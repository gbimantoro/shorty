# Shorty ⚡️

> Blazingly fast, super secure, tiny URL shortener on Cloudflare Workers & Cloudflare KV.

Shorty is built from first principles for the Cloudflare serverless edge: zero bloated dependencies, sub-millisecond KV lookups, asynchronous click tracking, and hardened against SSRF, timing attacks, and malicious redirection.

---

## Highlights

- **⚡️ Blazingly Fast**: Pure TypeScript running on V8 isolates worldwide. Direct KV reads resolve in sub-millisecond edge time. Edge caching headers (`Cache-Control: public, max-age=60, s-maxage=300`) allow repeat redirects to resolve in **< 5ms** without touching origin or KV.
- **🛡️ Super Secure**:
  - **SSRF Defense**: Strict URL parser blocking localhost, IPv4 RFC 1918 ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local (`169.254.0.0/16`), IPv6 loopbacks (`::1`, `fe80::`, `fc00::`), octal/hex IP tricks, credentials, and internal hostnames (`.local`, `.internal`, `.lan`).
  - **Protocol Enforcement**: Accepts **only** `http://` and `https://` (blocks `javascript:`, `data:`, `file:`, etc.).
  - **Timing Attack Defense**: Constant-time secret comparison via Web Crypto SHA-256 (`crypto.subtle.timingSafeEqual`).
  - **Slug Sanitization**: Strict `^[a-zA-Z0-9_-]{1,64}$` regex and reserved system route protection (`api`, `stats`, `health`, `robots.txt`, etc.).
  - **Defense-in-Depth Headers**: HSTS (`max-age=31536000`), CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, COOP, CORP, Permissions-Policy, and `X-Robots-Tag: noindex, nofollow` on redirects.
  - **Abuse Prevention**: Built-in sliding-window IP rate limiting and 16 KB body size cap.
- **🪶 Tiny**: Compressed worker bundle is **< 9 KiB** gzipped with zero external runtime dependencies.
- **🌐 Cloudflare Zone Integration**: Configured to connect to existing Cloudflare domain zones (`shorty.gbimantoro.com/*`) with automatic Workers Custom Domains DNS and SSL provisioning, plus `*.workers.dev` fallback.
- **📊 Non-blocking Analytics**: Click counting and last-accessed timestamps execute in background with `ctx.waitUntil()`, never blocking the redirect.
- **🎨 Embedded UI**: Fast, responsive dark-mode single-page app served from the root `/` with zero external CDN dependencies.

---

## Architecture

```
Client Request
      │
      ▼
Cloudflare Edge Worker (shorty)
      │
      ├── GET / ─────────────► Embedded Dark-Mode UI (or JSON API index)
      ├── GET /health ───────► Status {"status":"ok"}
      ├── GET /robots.txt ───► Disallow scrapers from crawling short links
      │
      ├── POST /api/shorten ──► Validate URL + Slug ──► Write to Cloudflare KV
      ├── GET /api/stats/:id ─► Read metadata & clicks from Cloudflare KV
      ├── DELETE /api/links/:id► Authenticated delete from Cloudflare KV
      │
      └── GET /:slug ────────► Sub-millisecond KV Read
                                    │
                                    ├── ctx.waitUntil(trackClick) [Async Background]
                                    └── 302 Found (Location: target) [Sub-10ms]
```

---

## API Reference

### 1. Create Short Link
```http
POST /api/shorten
Content-Type: application/json
Authorization: Bearer <API_KEY>   (Optional if API_KEY not set)

{
  "url": "https://github.com/gbimantoro",
  "slug": "custom-alias",        // Optional: 1-64 chars [a-zA-Z0-9_-]
  "expiresIn": 86400,             // Optional: TTL in seconds (min 60)
  "status": 302                   // Optional: 301, 302 (default), 307, 308
}
```

**Response (`201 Created`):**
```json
{
  "success": true,
  "data": {
    "slug": "custom-alias",
    "shortUrl": "https://shorty.gbimantoro.com/custom-alias",
    "target": "https://github.com/gbimantoro",
    "status": 302,
    "createdAt": 1794463510947,
    "expiresAt": 1794549910947
  }
}
```

### 2. Inspect Link Stats
```http
GET /api/stats/custom-alias
```

**Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "slug": "custom-alias",
    "target": "https://github.com/gbimantoro",
    "createdAt": 1794463510947,
    "expiresAt": null,
    "status": 302,
    "clicks": 42,
    "lastClickedAt": 1794463800120
  }
}
```

### 3. Delete Short Link
```http
DELETE /api/links/custom-alias
Authorization: Bearer <API_KEY>
```

---

## Local Development & Testing

```bash
# Install dependencies
npm install

# Run unit & integration tests (22 tests)
npm test

# Run TypeScript type check
npm run typecheck

# Start local server with workerd & simulated KV
npm run dev
# Visit http://localhost:8787
```

---

## Cloudflare Deployment

### 1. Create Production KV Namespace
```bash
npx wrangler kv namespace create SHORTY_KV
```
Update the returned `id` in `wrangler.jsonc`:
```jsonc
"kv_namespaces": [
  {
    "binding": "SHORTY_KV",
    "id": "<YOUR_KV_NAMESPACE_ID>",
    "preview_id": "<YOUR_PREVIEW_KV_ID>"
  }
]
```

### 2. Set Admin API Key (Optional)
If you wish to require authentication for creating and deleting links:
```bash
npx wrangler secret put API_KEY
```

### 3. Deploy to Cloudflare Workers
Ensure `CLOUDFLARE_API_TOKEN` is set in your environment:
```bash
export CLOUDFLARE_API_TOKEN="your-cloudflare-api-token"
npm run deploy
```

The Worker will be deployed as **`shorty`** and connected to your Cloudflare domain zone (`shorty.gbimantoro.com/*`) with automatic SSL and DNS routing.
