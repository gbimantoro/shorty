import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateTargetUrl,
  validateSlug,
  generateSlug,
  timingSafeCompare,
  verifyAuth,
  checkRateLimit,
  addSecurityHeaders
} from "../src/security";
import worker from "../src/index";
import type { Env, LinkRecord } from "../src/types";

describe("Security & Validation", () => {
  describe("validateTargetUrl", () => {
    it("allows valid public HTTPS URLs", () => {
      const res = validateTargetUrl("https://github.com/gbimantoro");
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.url, "https://github.com/gbimantoro");
      }
    });

    it("allows valid public HTTP URLs", () => {
      const res = validateTargetUrl("http://example.com/test?query=1#frag");
      assert.equal(res.ok, true);
    });

    it("rejects non-http protocols (SSRF / XSS)", () => {
      assert.equal(validateTargetUrl("javascript:alert(1)").ok, false);
      assert.equal(validateTargetUrl("data:text/html,<h1>test</h1>").ok, false);
      assert.equal(validateTargetUrl("file:///etc/passwd").ok, false);
      assert.equal(validateTargetUrl("ftp://ftp.example.com").ok, false);
    });

    it("rejects localhost and loopback", () => {
      assert.equal(validateTargetUrl("http://localhost:8080").ok, false);
      assert.equal(validateTargetUrl("http://127.0.0.1:3000").ok, false);
      assert.equal(validateTargetUrl("http://127.1.2.3").ok, false);
      assert.equal(validateTargetUrl("http://[::1]:80").ok, false);
    });

    it("rejects private RFC1918 / internal IP ranges", () => {
      assert.equal(validateTargetUrl("http://192.168.1.1").ok, false);
      assert.equal(validateTargetUrl("http://10.0.0.1/admin").ok, false);
      assert.equal(validateTargetUrl("http://172.16.0.100").ok, false);
      assert.equal(validateTargetUrl("http://169.254.169.254/metadata").ok, false);
    });

    it("rejects internal domains", () => {
      assert.equal(validateTargetUrl("http://service.internal").ok, false);
      assert.equal(validateTargetUrl("http://router.local").ok, false);
      assert.equal(validateTargetUrl("http://db.lan").ok, false);
    });

    it("rejects credentials in target URL", () => {
      assert.equal(validateTargetUrl("https://admin:secret@example.com").ok, false);
    });

    it("rejects empty or overly long URLs", () => {
      assert.equal(validateTargetUrl("").ok, false);
      assert.equal(validateTargetUrl("https://example.com/" + "a".repeat(2100)).ok, false);
    });
  });

  describe("validateSlug", () => {
    it("allows valid slugs", () => {
      assert.equal(validateSlug("my-custom_link123").ok, true);
    });

    it("rejects reserved system keywords", () => {
      assert.equal(validateSlug("api").ok, false);
      assert.equal(validateSlug("health").ok, false);
      assert.equal(validateSlug("robots.txt").ok, false);
      assert.equal(validateSlug("stats").ok, false);
    });

    it("rejects path traversal and unsafe characters", () => {
      assert.equal(validateSlug("../evil").ok, false);
      assert.equal(validateSlug("link/sub").ok, false);
      assert.equal(validateSlug("link?query").ok, false);
      assert.equal(validateSlug("link#frag").ok, false);
      assert.equal(validateSlug("link with space").ok, false);
    });

    it("enforces length limits", () => {
      assert.equal(validateSlug("").ok, false);
      assert.equal(validateSlug("a".repeat(65)).ok, false);
    });
  });

  describe("generateSlug", () => {
    it("generates base62 slug of specified length", () => {
      const slug = generateSlug(8);
      assert.equal(slug.length, 8);
      assert.match(slug, /^[a-zA-Z0-9]+$/);
    });

    it("produces unique values across calls", () => {
      const set = new Set(Array.from({ length: 50 }, () => generateSlug(6)));
      assert.equal(set.size, 50);
    });
  });

  describe("timingSafeCompare & verifyAuth", () => {
    it("compares equal and unequal strings", async () => {
      assert.equal(await timingSafeCompare("secret123", "secret123"), true);
      assert.equal(await timingSafeCompare("secret123", "secret999"), false);
      assert.equal(await timingSafeCompare("short", "longer-string"), false);
    });

    it("verifies auth via Bearer and X-API-Key", async () => {
      const secret = "test-secret-token-2026";

      // Open mode when no key configured
      const reqOpen = new Request("https://shorty.test/api/shorten");
      assert.equal(await verifyAuth(reqOpen, undefined), true);

      // Bearer header
      const reqBearer = new Request("https://shorty.test/api/shorten", {
        headers: { Authorization: `Bearer ${secret}` }
      });
      assert.equal(await verifyAuth(reqBearer, secret), true);

      // X-API-Key header
      const reqApiKey = new Request("https://shorty.test/api/shorten", {
        headers: { "X-API-Key": secret }
      });
      assert.equal(await verifyAuth(reqApiKey, secret), true);

      // Wrong key
      const reqBad = new Request("https://shorty.test/api/shorten", {
        headers: { Authorization: "Bearer wrong-key" }
      });
      assert.equal(await verifyAuth(reqBad, secret), false);
    });
  });

  describe("checkRateLimit", () => {
    it("tracks and restricts requests exceeding limit", () => {
      const testIp = "203.0.113.42";
      for (let i = 0; i < 5; i++) {
        const res = checkRateLimit(testIp, 5);
        assert.equal(res.allowed, true);
      }
      const blocked = checkRateLimit(testIp, 5);
      assert.equal(blocked.allowed, false);
      assert.equal(blocked.remaining, 0);
    });
  });

  describe("addSecurityHeaders", () => {
    it("attaches required security headers", () => {
      const base = new Response("ok", { status: 200 });
      const secured = addSecurityHeaders(base);
      assert.equal(secured.headers.get("X-Content-Type-Options"), "nosniff");
      assert.equal(secured.headers.get("X-Frame-Options"), "DENY");
      assert.equal(secured.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
      assert.match(secured.headers.get("Strict-Transport-Security") || "", /max-age=31536000/);
      assert.match(secured.headers.get("Content-Security-Policy") || "", /default-src 'self'/);
    });
  });
});

describe("Worker Request & KV Integration", () => {
  // In-memory KV Mock
  function createMockKV(): KVNamespace {
    const store = new Map<string, string>();
    return {
      async get(key: string) {
        return store.get(key) ?? null;
      },
      async put(key: string, value: string) {
        store.set(key, value);
      },
      async delete(key: string) {
        store.delete(key);
      }
    } as unknown as KVNamespace;
  }

  const mockCtx = {
    waitUntil(promise: Promise<unknown>) {
      // execute in background
      promise.catch(() => {});
    },
    passThroughOnException() {}
  } as unknown as ExecutionContext;

  it("serves HTML UI at root /", async () => {
    const env: Env = { SHORTY_KV: createMockKV() };
    const req = new Request("https://shorty.example.com/");
    const res = await worker.fetch(req, env, mockCtx);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("Content-Type") || "", /text\/html/);
    const body = await res.text();
    assert.match(body, /Shorty/);
  });

  it("serves /health endpoint", async () => {
    const env: Env = { SHORTY_KV: createMockKV() };
    const req = new Request("https://shorty.example.com/health");
    const res = await worker.fetch(req, env, mockCtx);
    assert.equal(res.status, 200);
    const data = await res.json() as { status: string };
    assert.equal(data.status, "ok");
  });

  it("serves /robots.txt disallowing crawling", async () => {
    const env: Env = { SHORTY_KV: createMockKV() };
    const req = new Request("https://shorty.example.com/robots.txt");
    const res = await worker.fetch(req, env, mockCtx);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /Disallow: \//);
  });

  it("creates a short link and redirects via /:slug", async () => {
    const env: Env = { SHORTY_KV: createMockKV() };

    // 1. Shorten
    const createReq = new Request("https://shorty.example.com/api/shorten", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://github.com/gbimantoro/shorty",
        slug: "gh-shorty"
      })
    });
    const createRes = await worker.fetch(createReq, env, mockCtx);
    assert.equal(createRes.status, 201);
    const createdData = await createRes.json() as { success: boolean; data: { slug: string; shortUrl: string } };
    assert.equal(createdData.success, true);
    assert.equal(createdData.data.slug, "gh-shorty");
    assert.equal(createdData.data.shortUrl, "https://shorty.example.com/gh-shorty");

    // 2. Redirect
    const redirectReq = new Request("https://shorty.example.com/gh-shorty");
    const redirectRes = await worker.fetch(redirectReq, env, mockCtx);
    assert.equal(redirectRes.status, 302);
    assert.equal(redirectRes.headers.get("Location"), "https://github.com/gbimantoro/shorty");

    // 3. Stats inspection
    const statsReq = new Request("https://shorty.example.com/api/stats/gh-shorty");
    const statsRes = await worker.fetch(statsReq, env, mockCtx);
    assert.equal(statsRes.status, 200);
    const statsData = await statsRes.json() as { success: boolean; data: LinkRecord };
    assert.equal(statsData.success, true);
    assert.equal(statsData.data.target, "https://github.com/gbimantoro/shorty");

    // 4. Delete
    const deleteReq = new Request("https://shorty.example.com/api/links/gh-shorty", { method: "DELETE" });
    const deleteRes = await worker.fetch(deleteReq, env, mockCtx);
    assert.equal(deleteRes.status, 200);

    // 5. Verify 404 after deletion
    const afterDeleteReq = new Request("https://shorty.example.com/gh-shorty");
    const afterDeleteRes = await worker.fetch(afterDeleteReq, env, mockCtx);
    assert.equal(afterDeleteRes.status, 404);
  });
});
