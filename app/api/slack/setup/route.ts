/**
 * app/api/slack/setup/route.ts
 *
 * Web UI for workspace Bloom setup (token-gated).
 */

import { getWorkspaceBySetupToken, initDb } from "@/lib/db";

/** Escapes HTML entities for safe interpolation into HTML templates. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** JSON embedded into the setup page for client-side bootstrapping. */
type SetupConfig = {
  token: string;
  skipApiKey: boolean;
  teamName: string;
};

/** Renders the full setup HTML document for a valid workspace token. */
function renderSetupPage(cfg: SetupConfig): Response {
  const json = JSON.stringify(cfg);
  const safeTeam = escapeHtml(cfg.teamName || "your workspace");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Bloom — Connect workspace</title>
  <style>
    :root {
      --bg: #0a0a0a;
      --text: #f5f0e8;
      --muted: rgba(245, 240, 232, 0.65);
      --accent: #ff4500;
      --accent-dim: #c73700;
      --card: #141414;
      --border: rgba(245, 240, 232, 0.12);
      --radius: 12px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 24px 16px 48px;
    }
    .wrap { max-width: 520px; margin: 0 auto; }
    h1 {
      font-size: 1.35rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      margin: 0 0 8px;
    }
    .sub { color: var(--muted); font-size: 0.95rem; margin-bottom: 28px; }
    .panel {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px;
      margin-bottom: 16px;
    }
    label { display: block; font-size: 0.85rem; color: var(--muted); margin-bottom: 8px; }
    input[type="password"], input[type="text"] {
      width: 100%;
      padding: 12px 14px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: #0a0a0a;
      color: var(--text);
      font-size: 1rem;
    }
    input:focus {
      outline: 2px solid var(--accent);
      outline-offset: 1px;
    }
    button, .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 18px;
      border-radius: 8px;
      border: none;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      background: var(--accent);
      color: #fff;
      margin-top: 14px;
      width: 100%;
    }
    button:disabled, .btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    button.secondary {
      background: transparent;
      color: var(--text);
      border: 1px solid var(--border);
    }
    .err {
      color: #ff8a80;
      font-size: 0.9rem;
      margin-top: 10px;
      display: none;
    }
    .err.show { display: block; }
    .brand-grid { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
    .brand-card {
      text-align: left;
      padding: 14px 16px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: #0a0a0a;
      cursor: pointer;
      color: var(--text);
      width: 100%;
      margin: 0;
    }
    .brand-card:hover { border-color: rgba(255, 69, 0, 0.45); }
    .brand-card.selected {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent);
    }
    .brand-name { font-weight: 600; }
    .brand-meta { font-size: 0.8rem; color: var(--muted); margin-top: 4px; }
    .hidden { display: none !important; }
    .success-cmd {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background: #0a0a0a;
      border: 1px solid var(--border);
      padding: 12px 14px;
      border-radius: 8px;
      font-size: 0.9rem;
      margin-top: 12px;
      word-break: break-all;
    }
    .logo { color: var(--accent); font-weight: 700; letter-spacing: 0.04em; font-size: 0.75rem; text-transform: uppercase; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="logo">Bloom</div>
    <h1>Connect Bloom to Slack</h1>
    <p class="sub">Workspace: <strong>${safeTeam}</strong></p>

    <script type="application/json" id="setup-config">${json.replace(/</g, "\\u003c")}</script>

    <div id="step1" class="panel${cfg.skipApiKey ? " hidden" : ""}">
      <label for="api-key">Bloom API key</label>
      <input id="api-key" type="password" autocomplete="off" placeholder="Paste your Bloom API key" />
      <button type="button" id="btn-validate">Validate</button>
      <div id="err1" class="err"></div>
    </div>

    <div id="step2" class="panel${cfg.skipApiKey ? "" : " hidden"}">
      <label>Select a brand</label>
      <p class="sub" style="margin:0 0 12px;">Choose which brand this workspace should use for generations.</p>
      <div id="brand-grid" class="brand-grid"></div>
      <button type="button" id="btn-save" disabled>Save &amp; Start</button>
      <div id="err2" class="err"></div>
    </div>

    <div id="success" class="panel hidden">
      <h1 style="margin-top:0;">You&apos;re all set</h1>
      <p class="sub" style="margin-bottom:0;">Bloom is connected. Try this in Slack:</p>
      <div class="success-cmd">/bloom-bot generate summer sale hero 16:9</div>
    </div>
  </div>

  <script>
(function () {
  var el = document.getElementById("setup-config");
  var cfg = JSON.parse(el.textContent);
  var step1 = document.getElementById("step1");
  var step2 = document.getElementById("step2");
  var success = document.getElementById("success");
  var apiInput = document.getElementById("api-key");
  var btnVal = document.getElementById("btn-validate");
  var btnSave = document.getElementById("btn-save");
  var err1 = document.getElementById("err1");
  var err2 = document.getElementById("err2");
  var grid = document.getElementById("brand-grid");

  var brands = [];
  var selected = null;

  function showErr(which, msg) {
    var n = which === 1 ? err1 : err2;
    n.textContent = msg || "";
    n.classList.toggle("show", !!msg);
  }

  function resolveSessionId(b) {
    if (b.brandSessionId) return b.brandSessionId;
    if (b.brand_session_id) return b.brand_session_id;
    return b.id;
  }

  function renderBrands() {
    grid.innerHTML = "";
    brands.forEach(function (b) {
      var card = document.createElement("button");
      card.type = "button";
      card.className = "brand-card";
      card.dataset.id = b.id;
      card.innerHTML =
        '<div class="brand-name"></div><div class="brand-meta"></div>';
      card.querySelector(".brand-name").textContent = b.name || "(unnamed)";
      var st = (b.status || "") + (b.url ? " · " + b.url : "");
      card.querySelector(".brand-meta").textContent = st;
      card.addEventListener("click", function () {
        Array.prototype.forEach.call(grid.querySelectorAll(".brand-card"), function (c) {
          c.classList.remove("selected");
        });
        card.classList.add("selected");
        selected = b;
        btnSave.disabled = false;
      });
      grid.appendChild(card);
    });
  }

  async function postJSON(url, body) {
    var res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    var data = null;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error("Bad response");
    }
    return { ok: res.ok, data: data };
  }

  async function runValidate(apiKey) {
    showErr(1, "");
    btnVal.disabled = true;
    try {
      var r = await postJSON("/api/slack/setup/validate-key", {
        api_key: apiKey,
        token: cfg.token,
      });
      if (!r.ok || !r.data || !r.data.valid) {
        showErr(1, "Could not validate that API key. Check the key and try again.");
        return;
      }
      brands = r.data.brands || [];
      if (!brands.length) {
        showErr(1, "No brands found for this API key.");
        return;
      }
      step1.classList.add("hidden");
      step2.classList.remove("hidden");
      renderBrands();
    } catch (e) {
      showErr(1, "Network error. Please try again.");
    } finally {
      btnVal.disabled = false;
    }
  }

  btnVal.addEventListener("click", function () {
    var key = (apiInput.value || "").trim();
    if (!key && !cfg.skipApiKey) {
      showErr(1, "Enter your Bloom API key.");
      return;
    }
    runValidate(cfg.skipApiKey ? "" : key);
  });

  btnSave.addEventListener("click", async function () {
    showErr(2, "");
    if (!selected) return;
    btnSave.disabled = true;
    var key = (apiInput.value || "").trim();
    var body = {
      token: cfg.token,
      bloom_api_key: cfg.skipApiKey ? "" : key,
      brand_id: selected.id,
      brand_name: selected.name || "",
      brand_session_id: resolveSessionId(selected),
    };
    try {
      var r = await postJSON("/api/slack/setup/save", body);
      if (!r.ok || !r.data || !r.data.success) {
        showErr(2, (r.data && r.data.error) || "Save failed.");
        btnSave.disabled = false;
        return;
      }
      step2.classList.add("hidden");
      success.classList.remove("hidden");
    } catch (e) {
      showErr(2, "Network error. Please try again.");
      btnSave.disabled = false;
    }
  });

  if (cfg.skipApiKey) {
    step1.classList.add("hidden");
    step2.classList.remove("hidden");
    apiInput.value = "";
    runValidate("");
  }
})();
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/** Renders a minimal HTML error page for invalid or expired setup links. */
function errorPage(message: string, status: number): Response {
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Setup</title>
<style>body{background:#0a0a0a;color:#f5f0e8;font-family:system-ui;padding:32px;}
a{color:#ff4500}</style></head><body><h1>Setup unavailable</h1><p>${escapeHtml(message)}</p></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/**
 * GET /api/slack/setup?token={setupToken}
 *
 * Serves the setup web page for configuring a Slack workspace.
 * Gated by a setup_token — only the workspace installer can access it.
 *
 * If API key is already saved (returning admin):
 *   Shows brand selection only — skip API key entry.
 * If first time:
 *   Shows step 1 (API key) then step 2 (brand selection).
 *
 * Returns HTML with an inline script that:
 *   1. Calls /api/slack/setup/validate-key to validate + list brands
 *   2. Calls /api/slack/setup/save to save the configuration
 *   3. Shows success state when done
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token")?.trim() ?? "";

  if (!token) {
    return errorPage("Missing setup token. Open the link from your Slack DM.", 400);
  }

  try {
    await initDb();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return errorPage(msg, 500);
  }

  const workspace = await getWorkspaceBySetupToken(token);
  if (!workspace) {
    return errorPage(
      "This setup link is invalid or has expired. Reinstall the app or request a new link from your admin.",
      404
    );
  }

  const skipApiKey = workspace.bloom_api_key.trim().length > 0;

  const cfg: SetupConfig = {
    token,
    skipApiKey,
    teamName: workspace.team_name || "",
  };

  return renderSetupPage(cfg);
}
