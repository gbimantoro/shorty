import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateTargetUrl,
  validateSlug,
  generateSlug,
  timingSafeCompare,
  verifyAuth,
  signSessionToken,
  verifySessionToken,
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
      assert.equal(validateSlug("login").ok, false);
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

    it("verifies auth via Bearer and X-API-Key and fails closed when unconfigured", async () => {
      const secret = "test-secret-token-2026";

      // Fail closed when no key configured
      const reqOpen = new Request("https://shorty.test/api/shorten");
      assert.equal(await verifyAuth(reqOpen, undefined), false);

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

  describe("HMAC Session Tokens", () => {
    const secret = "0123456789abcdef0123456789abcdef0123456789abcdef";

    it("signs and verifies valid session token", async () => {
      const token = await signSessionToken("admin", secret, 3600);
      const payload = await verifySessionToken(token, secret);
      assert.ok(payload);
      assert.equal(payload.sub, "admin");
    });

    it("rejects tampered session token", async () => {
      const token = await signSessionToken("admin", secret, 3600);
      const tampered = token.slice(0, -4) + "xxxx";
      assert.equal(await verifySessionToken(tampered, secret), null);
    });

    it("rejects expired session token", async () => {
      const token = await signSessionToken("admin", secret, -10);
      assert.equal(await verifySessionToken(token, secret), null);
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

describe("Worker Request, Auth & KV Integration", () => {
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
      },
      async list(opts?: { prefix?: string }) {
        const prefix = opts?.prefix || "";
        const keys = Array.from(store.keys())
          .filter((k) => k.startsWith(prefix))
          .map((name) => ({ name }));
        return { keys, list_complete: true, cacheStatus: null };
      }
    } as unknown as KVNamespace;
  }

  const mockCtx = {
    waitUntil(promise: Promise<unknown>) {
      promise.catch(() => {});
    },
    passThroughOnException() {}
  } as unknown as ExecutionContext;

  function createEnv(): Env {
    return {
      SHORTY_KV: createMockKV(),
      ADMIN_USERNAME: "admin",
      ADMIN_PASSWORD: "SuperStrongPassword!2026",
      SESSION_SECRET: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6",
      API_KEY: "api-key-super-secret-2026"
    };
  }

  it("serves HTML UI at root /", async () => {
    const env = createEnv();
    const req = new Request("https://shorty.example.com/");
    const res = await worker.fetch(req, env, mockCtx);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("Content-Type") || "", /text\/html/);
    const body = await res.text();
    assert.match(body, /Shorty/);
  });

  it("serves /health and /robots.txt", async () => {
    const env = createEnv();
    const healthRes = await worker.fetch(new Request("https://shorty.example.com/health"), env, mockCtx);
    assert.equal(healthRes.status, 200);
    const data = (await healthRes.json()) as { status: string };
    assert.equal(data.status, "ok");

    const robotsRes = await worker.fetch(new Request("https://shorty.example.com/robots.txt"), env, mockCtx);
    assert.equal(robotsRes.status, 200);
    assert.match(await robotsRes.text(), /Disallow: \//);
  });

  it("fails closed on login when secrets are missing", async () => {
    const env: Env = { SHORTY_KV: createMockKV() };
    const req = new Request("https://shorty.example.com/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "pw" })
    });
    const res = await worker.fetch(req, env, mockCtx);
    assert.equal(res.status, 503);
  });

  it("rejects unauthenticated access to protected endpoints", async () => {
    const env = createEnv();
    const resShorten = await worker.fetch(
      new Request("https://shorty.example.com/api/shorten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" })
      }),
      env,
      mockCtx
    );
    assert.equal(resShorten.status, 401);

    const resLinks = await worker.fetch(new Request("https://shorty.example.com/api/links"), env, mockCtx);
    assert.equal(resLinks.status, 401);

    const resStats = await worker.fetch(new Request("https://shorty.example.com/api/stats/test"), env, mockCtx);
    assert.equal(resStats.status, 401);
  });

  it("throttles repeated failed login attempts", async () => {
    const env = createEnv();
    const ip = "198.51.100.99";

    for (let i = 0; i < 4; i++) {
      const res = await worker.fetch(
        new Request("https://shorty.example.com/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
          body: JSON.stringify({ username: "admin", password: "wrong" })
        }),
        env,
        mockCtx
      );
      assert.equal(res.status, 401);
    }

    // 5th failure locks the IP
    const lockedRes = await worker.fetch(
      new Request("https://shorty.example.com/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
        body: JSON.stringify({ username: "admin", password: "wrong" })
      }),
      env,
      mockCtx
    );
    assert.equal(lockedRes.status, 429);
    assert.ok(lockedRes.headers.get("Retry-After"));
  });

  it("authenticates via login cookie, creates, lists, stats, redirects publicly, and logs out", async () => {
    const env = createEnv();

    // 1. Login
    const loginRes = await worker.fetch(
      new Request("https://shorty.example.com/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.10" },
        body: JSON.stringify({ username: "admin", password: "SuperStrongPassword!2026" })
      }),
      env,
      mockCtx
    );
    assert.equal(loginRes.status, 200);
    const setCookie = loginRes.headers.get("Set-Cookie") || "";
    assert.match(setCookie, /shorty_session=/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    const cookiePair = setCookie.split(";")[0];

    // 2. Check /api/auth/me
    const meRes = await worker.fetch(
      new Request("https://shorty.example.com/api/auth/me", {
        headers: { Cookie: cookiePair }
      }),
      env,
      mockCtx
    );
    assert.equal(meRes.status, 200);

    // 3. Create short link with session cookie
    const createRes = await worker.fetch(
      new Request("https://shorty.example.com/api/shorten", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookiePair },
        body: JSON.stringify({
          url: "https://github.com/gbimantoro/shorty",
          slug: "gh-shorty"
        })
      }),
      env,
      mockCtx
    );
    assert.equal(createRes.status, 201);

    // 4. List links
    const listRes = await worker.fetch(
      new Request("https://shorty.example.com/api/links", {
        headers: { Cookie: cookiePair }
      }),
      env,
      mockCtx
    );
    assert.equal(listRes.status, 200);
    const listData = (await listRes.json()) as { success: boolean; data: LinkRecord[] };
    assert.equal(listData.data.length, 1);

    // 5. Public redirect (NO auth cookie needed!)
    const redirectRes = await worker.fetch(new Request("https://shorty.example.com/gh-shorty"), env, mockCtx);
    assert.equal(redirectRes.status, 302);
    assert.equal(redirectRes.headers.get("Location"), "https://github.com/gbimantoro/shorty");

    // 6. Stats inspection (authenticated)
    const statsRes = await worker.fetch(
      new Request("https://shorty.example.com/api/stats/gh-shorty", {
        headers: { Cookie: cookiePair }
      }),
      env,
      mockCtx
    );
    assert.equal(statsRes.status, 200);

    // 7. Delete (authenticated)
    const deleteRes = await worker.fetch(
      new Request("https://shorty.example.com/api/links/gh-shorty", {
        method: "DELETE",
        headers: { Cookie: cookiePair }
      }),
      env,
      mockCtx
    );
    assert.equal(deleteRes.status, 200);

    // 8. Logout
    const logoutRes = await worker.fetch(
      new Request("https://shorty.example.com/api/auth/logout", { method: "POST" }),
      env,
      mockCtx
    );
    assert.equal(logoutRes.status, 200);
    assert.match(logoutRes.headers.get("Set-Cookie") || "", /Max-Age=0/);
  });
});
