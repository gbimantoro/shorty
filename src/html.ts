export function renderHtml(appName = "Shorty"): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${appName} · Fast & Secure Edge URL Shortener</title>
  <style>
    :root {
      --bg: #090a0f;
      --card: #12151e;
      --border: #232938;
      --text: #e6edf3;
      --muted: #8b949e;
      --accent: #10b981;
      --accent-hover: #059669;
      --danger: #ef4444;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .container {
      width: 100%;
      max-width: 620px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 2rem;
      box-shadow: 0 16px 40px rgba(0,0,0,0.5);
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.5rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1rem;
      gap: 0.5rem;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 700;
      font-size: 1.25rem;
      letter-spacing: -0.02em;
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .badge {
      font-family: var(--font-mono);
      font-size: 0.7rem;
      background: rgba(16, 185, 129, 0.15);
      color: var(--accent);
      padding: 0.2rem 0.55rem;
      border-radius: 9999px;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .logout-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--muted);
      padding: 0.25rem 0.6rem;
      border-radius: 6px;
      font-size: 0.75rem;
      cursor: pointer;
    }
    .logout-btn:hover { color: var(--text); border-color: var(--muted); }
    .tabs {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
    }
    .tab-btn {
      flex: 1;
      background: transparent;
      border: 1px solid var(--border);
      color: var(--muted);
      padding: 0.5rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 500;
      transition: all 0.15s;
    }
    .tab-btn.active {
      background: var(--border);
      color: var(--text);
      border-color: var(--text);
    }
    .field {
      margin-bottom: 1rem;
    }
    label {
      display: block;
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--muted);
      margin-bottom: 0.35rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    input, select {
      width: 100%;
      background: #0d1117;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.65rem 0.85rem;
      color: var(--text);
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.15s;
    }
    input:focus, select:focus {
      border-color: var(--accent);
    }
    .btn {
      width: 100%;
      background: var(--accent);
      color: #000;
      border: none;
      border-radius: 6px;
      padding: 0.75rem;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
      margin-top: 0.5rem;
    }
    .btn:hover { background: var(--accent-hover); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .result-box {
      margin-top: 1.5rem;
      padding: 1rem;
      background: #0d1117;
      border: 1px solid var(--border);
      border-radius: 6px;
      display: none;
    }
    .result-url {
      font-family: var(--font-mono);
      font-size: 0.9rem;
      color: var(--accent);
      word-break: break-all;
      margin-bottom: 0.75rem;
      display: block;
    }
    .copy-btn {
      background: var(--border);
      color: var(--text);
      border: none;
      border-radius: 4px;
      padding: 0.35rem 0.7rem;
      font-size: 0.78rem;
      cursor: pointer;
      font-weight: 500;
    }
    .del-btn {
      background: rgba(239, 68, 68, 0.12);
      color: var(--danger);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 4px;
      padding: 0.35rem 0.6rem;
      font-size: 0.75rem;
      cursor: pointer;
    }
    .error-msg {
      margin-top: 1rem;
      color: var(--danger);
      font-size: 0.85rem;
      display: none;
    }
    .footer {
      margin-top: 1.5rem;
      font-size: 0.75rem;
      color: var(--muted);
      text-align: center;
    }
    .stats-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 0.5rem;
      font-size: 0.85rem;
    }
    .stats-table td {
      padding: 0.4rem 0;
      border-bottom: 1px solid var(--border);
    }
    .stats-table td:first-child {
      color: var(--muted);
      width: 35%;
    }
    .stats-table td:last-child {
      font-family: var(--font-mono);
      word-break: break-all;
    }
    .links-list {
      margin-top: 1rem;
      max-height: 360px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }
    .link-item {
      background: #0d1117;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.75rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.75rem;
    }
    .link-meta { min-width: 0; flex: 1; }
    .link-slug {
      font-family: var(--font-mono);
      color: var(--accent);
      font-size: 0.9rem;
      font-weight: 600;
      text-decoration: none;
    }
    .link-target {
      font-size: 0.78rem;
      color: var(--muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 0.2rem;
    }
    .link-actions {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-shrink: 0;
    }
    .clicks-pill {
      font-family: var(--font-mono);
      font-size: 0.72rem;
      color: var(--muted);
      background: var(--card);
      border: 1px solid var(--border);
      padding: 0.2rem 0.45rem;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
        <span>${appName}</span>
      </div>
      <div class="header-right">
        <span class="badge" id="user-badge">Edge KV</span>
        <button class="logout-btn" id="logout-btn" style="display:none;" onclick="handleLogout()">Logout</button>
      </div>
    </div>

    <!-- Loading -->
    <div id="view-loading" style="text-align:center; padding:2rem 0; color:var(--muted); font-size:0.9rem;">
      Checking session...
    </div>

    <!-- Login View -->
    <div id="view-login" style="display:none;">
      <form onsubmit="handleLogin(event)">
        <div class="field">
          <label for="login-user">Username</label>
          <input type="text" id="login-user" autocomplete="username" required placeholder="admin" />
        </div>
        <div class="field">
          <label for="login-pass">Password</label>
          <input type="password" id="login-pass" autocomplete="current-password" required placeholder="••••••••••••" />
        </div>
        <button type="submit" class="btn" id="login-btn">Sign In</button>
      </form>
      <div class="error-msg" id="login-error"></div>
    </div>

    <!-- App View -->
    <div id="view-app" style="display:none;">
      <div class="tabs">
        <button class="tab-btn active" id="tab-shorten-btn" onclick="switchTab('shorten')">Shorten</button>
        <button class="tab-btn" id="tab-links-btn" onclick="switchTab('links')">Links</button>
        <button class="tab-btn" id="tab-stats-btn" onclick="switchTab('stats')">Stats</button>
      </div>

      <!-- Shorten Panel -->
      <div id="panel-shorten">
        <form id="shorten-form" onsubmit="handleShorten(event)">
          <div class="field">
            <label for="url">Target URL (http / https)</label>
            <input type="url" id="url" required placeholder="https://example.com/very/long/url..." />
          </div>
          <div class="field">
            <label for="custom-slug">Custom Alias (Optional)</label>
            <input type="text" id="custom-slug" placeholder="e.g. spring-event-2026" maxlength="64" />
          </div>
          <button type="submit" class="btn" id="submit-btn">Shorten URL</button>
        </form>

        <div class="error-msg" id="shorten-error"></div>

        <div class="result-box" id="shorten-result">
          <span class="result-url" id="short-url-text"></span>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <button class="copy-btn" id="copy-btn" onclick="copyResult()">Copy Short Link</button>
            <a id="visit-link" href="#" target="_blank" style="color:var(--muted); font-size:0.8rem; text-decoration:none;">Open ↗</a>
          </div>
        </div>
      </div>

      <!-- Links Manager Panel -->
      <div id="panel-links" style="display:none;">
        <div class="field" style="margin-bottom:0.5rem;">
          <input type="text" id="links-search" placeholder="Search slug or target URL..." oninput="renderLinks()" />
        </div>
        <div id="links-count" style="font-size:0.75rem; color:var(--muted);"></div>
        <div class="links-list" id="links-list"></div>
      </div>

      <!-- Stats Panel -->
      <div id="panel-stats" style="display:none;">
        <form id="stats-form" onsubmit="handleStats(event)">
          <div class="field">
            <label for="stats-slug">Slug or Short Link</label>
            <input type="text" id="stats-slug" required placeholder="e.g. daftar" />
          </div>
          <button type="submit" class="btn">Inspect Stats</button>
        </form>

        <div class="error-msg" id="stats-error"></div>

        <div class="result-box" id="stats-result">
          <table class="stats-table">
            <tr><td>Slug</td><td id="st-slug">-</td></tr>
            <tr><td>Target</td><td id="st-target">-</td></tr>
            <tr><td>Total Clicks</td><td id="st-clicks" style="color:var(--accent); font-weight:700;">-</td></tr>
            <tr><td>Created</td><td id="st-created">-</td></tr>
            <tr><td>Last Click</td><td id="st-last">-</td></tr>
            <tr><td>Expires</td><td id="st-expires">-</td></tr>
          </table>
        </div>
      </div>
    </div>

    <div class="footer">
      Powered by Cloudflare Workers &bull; Sub-10ms Edge Redirects &bull; HttpOnly Session Auth
    </div>
  </div>

  <script>
    let allLinks = [];

    async function init() {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          showApp(data.data.username);
          return;
        }
      } catch {}
      showLogin();
    }

    function showLogin() {
      document.getElementById("view-loading").style.display = "none";
      document.getElementById("view-app").style.display = "none";
      document.getElementById("logout-btn").style.display = "none";
      document.getElementById("user-badge").textContent = "Edge KV";
      document.getElementById("view-login").style.display = "block";
    }

    function showApp(username) {
      document.getElementById("view-loading").style.display = "none";
      document.getElementById("view-login").style.display = "none";
      document.getElementById("view-app").style.display = "block";
      document.getElementById("logout-btn").style.display = "inline-block";
      document.getElementById("user-badge").textContent = "@" + username;
    }

    async function handleLogin(e) {
      e.preventDefault();
      const errBox = document.getElementById("login-error");
      const btn = document.getElementById("login-btn");
      errBox.style.display = "none";
      btn.disabled = true;

      const username = document.getElementById("login-user").value.trim();
      const password = document.getElementById("login-pass").value;

      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Invalid credentials");
        }
        document.getElementById("login-pass").value = "";
        showApp(data.data.username);
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = "block";
      } finally {
        btn.disabled = false;
      }
    }

    async function handleLogout() {
      await fetch("/api/auth/logout", { method: "POST" });
      allLinks = [];
      showLogin();
    }

    function switchTab(tab) {
      document.getElementById("panel-shorten").style.display = tab === "shorten" ? "block" : "none";
      document.getElementById("panel-links").style.display = tab === "links" ? "block" : "none";
      document.getElementById("panel-stats").style.display = tab === "stats" ? "block" : "none";
      document.getElementById("tab-shorten-btn").className = tab === "shorten" ? "tab-btn active" : "tab-btn";
      document.getElementById("tab-links-btn").className = tab === "links" ? "tab-btn active" : "tab-btn";
      document.getElementById("tab-stats-btn").className = tab === "stats" ? "tab-btn active" : "tab-btn";
      if (tab === "links") loadLinks();
    }

    async function loadLinks() {
      const listEl = document.getElementById("links-list");
      listEl.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;">Loading links...</div>';
      try {
        const res = await fetch("/api/links");
        if (res.status === 401) return showLogin();
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || "Failed to load links");
        allLinks = data.data.sort((a, b) => (b.clicks || 0) - (a.clicks || 0));
        renderLinks();
      } catch (err) {
        listEl.innerHTML = '<div style="color:var(--danger);font-size:0.85rem;">' + err.message + '</div>';
      }
    }

    function renderLinks() {
      const q = (document.getElementById("links-search").value || "").toLowerCase();
      const filtered = allLinks.filter(l =>
        l.slug.toLowerCase().includes(q) || l.target.toLowerCase().includes(q)
      );
      document.getElementById("links-count").textContent = filtered.length + " link(s)";
      const listEl = document.getElementById("links-list");
      listEl.innerHTML = "";
      for (const item of filtered) {
        const row = document.createElement("div");
        row.className = "link-item";

        const meta = document.createElement("div");
        meta.className = "link-meta";
        const a = document.createElement("a");
        a.className = "link-slug";
        a.href = "/" + item.slug;
        a.target = "_blank";
        a.textContent = "/" + item.slug;
        const target = document.createElement("div");
        target.className = "link-target";
        target.textContent = item.target;
        meta.appendChild(a);
        meta.appendChild(target);

        const actions = document.createElement("div");
        actions.className = "link-actions";
        const pill = document.createElement("span");
        pill.className = "clicks-pill";
        pill.textContent = (item.clicks || 0) + " clicks";
        const cp = document.createElement("button");
        cp.className = "copy-btn";
        cp.textContent = "Copy";
        cp.onclick = () => {
          navigator.clipboard.writeText(window.location.origin + "/" + item.slug);
          cp.textContent = "Copied";
          setTimeout(() => cp.textContent = "Copy", 1200);
        };
        const del = document.createElement("button");
        del.className = "del-btn";
        del.textContent = "Delete";
        del.onclick = () => deleteLink(item.slug);

        actions.appendChild(pill);
        actions.appendChild(cp);
        actions.appendChild(del);
        row.appendChild(meta);
        row.appendChild(actions);
        listEl.appendChild(row);
      }
    }

    async function deleteLink(slug) {
      if (!confirm("Delete /" + slug + "?")) return;
      const res = await fetch("/api/links/" + encodeURIComponent(slug), { method: "DELETE" });
      if (res.status === 401) return showLogin();
      if (res.ok) {
        allLinks = allLinks.filter(l => l.slug !== slug);
        renderLinks();
      }
    }

    async function handleShorten(e) {
      e.preventDefault();
      const errBox = document.getElementById("shorten-error");
      const resBox = document.getElementById("shorten-result");
      const btn = document.getElementById("submit-btn");
      errBox.style.display = "none";
      resBox.style.display = "none";
      btn.disabled = true;

      const url = document.getElementById("url").value.trim();
      const slug = document.getElementById("custom-slug").value.trim() || undefined;

      try {
        const res = await fetch("/api/shorten", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, slug })
        });
        if (res.status === 401) return showLogin();
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to shorten URL");
        }
        document.getElementById("short-url-text").textContent = data.data.shortUrl;
        document.getElementById("visit-link").href = data.data.shortUrl;
        resBox.style.display = "block";
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = "block";
      } finally {
        btn.disabled = false;
      }
    }

    async function handleStats(e) {
      e.preventDefault();
      const errBox = document.getElementById("stats-error");
      const resBox = document.getElementById("stats-result");
      errBox.style.display = "none";
      resBox.style.display = "none";

      let slug = document.getElementById("stats-slug").value.trim();
      if (slug.includes("/")) {
        slug = slug.split("/").pop();
      }

      try {
        const res = await fetch("/api/stats/" + encodeURIComponent(slug));
        if (res.status === 401) return showLogin();
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Slug not found");
        }
        const s = data.data;
        document.getElementById("st-slug").textContent = s.slug;
        document.getElementById("st-target").textContent = s.target;
        document.getElementById("st-clicks").textContent = s.clicks.toLocaleString();
        document.getElementById("st-created").textContent = new Date(s.createdAt).toLocaleString();
        document.getElementById("st-last").textContent = s.lastClickedAt ? new Date(s.lastClickedAt).toLocaleString() : "Never";
        document.getElementById("st-expires").textContent = s.expiresAt ? new Date(s.expiresAt).toLocaleString() : "Permanent";
        resBox.style.display = "block";
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = "block";
      }
    }

    function copyResult() {
      const text = document.getElementById("short-url-text").textContent;
      navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById("copy-btn");
        btn.textContent = "Copied!";
        setTimeout(() => btn.textContent = "Copy Short Link", 2000);
      });
    }

    init();
  </script>
</body>
</html>`;
}
