(function () {
  const $ = (id) => document.getElementById(id);
  const profileList = $("profileList");
  const tpl = $("profileTpl");

  const DEFAULTS = { ollamaUrl: "http://localhost:11434", defaultModel: "", temperature: 0.4, autoSave: true, overwrite: true, haltOnError: true, fillCurriculum: false, dedupeCurriculum: false };

  let state = { settings: Object.assign({}, DEFAULTS), profiles: [] };

  function uid() { return "p_" + Math.random().toString(36).slice(2, 9) + (state.profiles.length); }

  async function load() {
    const store = await chrome.storage.local.get(["settings", "profiles"]);
    state.settings = Object.assign({}, DEFAULTS, store.settings || {});
    state.profiles = store.profiles || [];
    if (!state.profiles.length) state.profiles.push({ id: "iso-xpert", name: "ISO Xpert", fromName: "ISO Xpert", role: "", fields: {} });

    $("provider").value = state.settings.provider === "openai" ? "openai" : "ollama";
    $("ollamaUrl").value = state.settings.ollamaUrl;
    $("openaiApiKey").value = state.settings.openaiApiKey || "";
    applyProviderUi();
    $("temperature").value = state.settings.temperature;
    $("autoSave").checked = state.settings.autoSave !== false;
    $("overwrite").checked = state.settings.overwrite !== false;
    $("haltOnError").checked = state.settings.haltOnError !== false;
    $("autoUpdateCheck").checked = state.settings.autoUpdateCheck !== false;
    $("fillCurriculum").checked = state.settings.fillCurriculum === true;
    $("dedupeCurriculum").checked = state.settings.dedupeCurriculum === true;
    renderProfiles();
    await loadModels();
  }

  function isOpenAI() { return $("provider").value === "openai"; }
  function applyProviderUi() {
    const oa = isOpenAI();
    $("ollamaUrlField").hidden = oa;
    $("openaiKeyField").hidden = !oa;
    $("openaiNote").hidden = !oa;
  }
  $("provider").addEventListener("change", async () => { applyProviderUi(); await loadModels(); });

  function testPayload() {
    return { type: "TEST_OLLAMA", provider: $("provider").value, baseUrl: $("ollamaUrl").value, openaiApiKey: $("openaiApiKey").value };
  }

  async function loadModels() {
    const res = await chrome.runtime.sendMessage(testPayload());
    const sel = $("defaultModel");
    if (res && res.ok) {
      const models = res.models || [];
      sel.innerHTML = '<option value="">(ask each time)</option>' + models.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
      sel.value = state.settings.defaultModel || "";
    } else {
      sel.innerHTML = `<option value="">(${isOpenAI() ? "ChatGPT" : "Ollama"} not reachable)</option>`;
    }
  }

  function renderProfiles() {
    profileList.innerHTML = "";
    state.profiles.forEach((p) => {
      const node = tpl.content.cloneNode(true);
      node.querySelector(".p-name").value = p.name || "";
      node.querySelector(".p-from").value = p.fromName || "";
      node.querySelector(".p-role").value = p.role || "";
      node.querySelector(".del").addEventListener("click", () => {
        captureFromDom(); // preserve edits in other rows first
        state.profiles = state.profiles.filter((x) => x.id !== p.id);
        if (!state.profiles.length) state.profiles.push({ id: uid(), name: "", fromName: "", role: "" });
        renderProfiles();
      });
      // per-field prompts & on/off — each profile renders its OWN config (no cross-profile mixing)
      const list = node.querySelector(".field-list");
      const fieldTpl = $("fieldRowTpl");
      const cfg = (p.fields && typeof p.fields === "object") ? p.fields : {};
      (window.UdemyData.fields).forEach((f) => {
        const fr = fieldTpl.content.cloneNode(true);
        fr.querySelector(".f-label").textContent = f.label;
        const en = fr.querySelector(".f-en"); en.dataset.key = f.key;
        en.checked = !cfg[f.key] || cfg[f.key].en !== false; // default enabled
        const pr = fr.querySelector(".f-prompt"); pr.dataset.key = f.key;
        // pre-fill with a relevant default prompt (editable). Unchanged defaults use the built-in.
        const saved = cfg[f.key] && cfg[f.key].prompt;
        pr.value = (saved != null && saved !== "") ? saved : (f.defaultPrompt || "");
        list.appendChild(fr);
      });
      const row = document.createElement("div");
      row.className = "profile-wrap";
      row.dataset.id = p.id;
      row.appendChild(node);
      profileList.appendChild(row);
    });
  }

  function captureFromDom() {
    // read inputs back into state (so re-render keeps edits)
    const wraps = profileList.querySelectorAll(".profile-wrap");
    const next = [];
    wraps.forEach((w) => {
      const id = w.dataset.id;
      const fields = {};
      w.querySelectorAll(".f-en").forEach((en) => {
        const key = en.dataset.key;
        const pr = w.querySelector(`.f-prompt[data-key="${key}"]`);
        fields[key] = { en: en.checked, prompt: (pr ? pr.value : "").trim() };
      });
      next.push({
        id,
        name: w.querySelector(".p-name").value.trim(),
        fromName: w.querySelector(".p-from").value.trim(),
        role: w.querySelector(".p-role").value.trim(),
        fields
      });
    });
    if (next.length) state.profiles = next;
  }

  $("addProfile").addEventListener("click", () => {
    captureFromDom();
    state.profiles.push({ id: uid(), name: "", fromName: "", role: "" });
    renderProfiles();
  });

  $("loadStarters").addEventListener("click", () => {
    captureFromDom();
    const seeds = (typeof window.SeedProfiles !== "undefined" ? window.SeedProfiles : []);
    const clone = (o) => JSON.parse(JSON.stringify(o));
    let added = 0;
    seeds.forEach((s) => {
      const idx = state.profiles.findIndex((p) => (p.name || "").toLowerCase() === s.name.toLowerCase());
      if (idx < 0) { state.profiles.push(clone(s)); added++; return; }
      // upgrade a same-named profile that has no custom prompts yet; never overwrite a customised one
      const ex = state.profiles[idx];
      const hasPrompts = ex.fields && Object.values(ex.fields).some((f) => f && (f.prompt || "").trim());
      if (!hasPrompts) { state.profiles[idx] = clone(s); added++; }
    });
    if (added) state.profiles = state.profiles.filter((p) => p.name || p.fromName || p.role);
    renderProfiles();
    const msg = $("savedMsg"); msg.textContent = added ? `Added/updated ${added} profile(s) — click Save` : "All 6 already present"; setTimeout(() => (msg.textContent = ""), 2500);
  });

  $("testBtn").addEventListener("click", async () => {
    const out = $("testResult");
    out.textContent = "Testing…"; out.className = "test";
    const res = await chrome.runtime.sendMessage(testPayload());
    if (res && res.ok) {
      out.textContent = `Connected · ${(res.models || []).length} model(s)`;
      out.className = "test ok";
      $("corsNote").hidden = true;
      await loadModels();
    } else {
      out.className = "test bad";
      if (res && res.reason === "cors") { out.textContent = "Blocked by Ollama (CORS / 403)."; $("corsNote").hidden = false; }
      else if (res && res.reason === "offline") { out.textContent = isOpenAI() ? "Could not reach OpenAI." : "Not reachable — is Ollama running?"; }
      else if (res && res.reason === "nokey") { out.textContent = "Enter your OpenAI API key first."; }
      else if (res && res.reason === "badkey") { out.textContent = "OpenAI rejected the API key (401)."; }
      else { out.textContent = "Error: HTTP " + (res && res.status); }
    }
  });

  $("saveBtn").addEventListener("click", async () => {
    captureFromDom();
    state.settings.provider = $("provider").value === "openai" ? "openai" : "ollama";
    state.settings.ollamaUrl = $("ollamaUrl").value.trim() || DEFAULTS.ollamaUrl;
    state.settings.openaiApiKey = $("openaiApiKey").value.trim();
    state.settings.defaultModel = $("defaultModel").value;
    state.settings.temperature = clamp(parseFloat($("temperature").value), 0, 1, 0.4);
    state.settings.autoSave = $("autoSave").checked;
    state.settings.overwrite = $("overwrite").checked;
    state.settings.haltOnError = $("haltOnError").checked;
    state.settings.autoUpdateCheck = $("autoUpdateCheck").checked;
    state.settings.fillCurriculum = $("fillCurriculum").checked;
    state.settings.dedupeCurriculum = $("dedupeCurriculum").checked;
    // drop fully-empty profiles
    const profiles = state.profiles.filter((p) => p.name || p.fromName || p.role);
    await chrome.storage.local.set({ settings: state.settings, profiles });
    const msg = $("savedMsg");
    msg.textContent = "Saved ✓";
    setTimeout(() => (msg.textContent = ""), 2000);
  });

  // ---------- tabs ----------
  document.getElementById("tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab"); if (!btn) return;
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === btn));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + tab));
  });

  // ---------- version + about ----------
  (function meta() {
    let version = "2.0.0";
    try { version = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || version; } catch (_) {}
    const v1 = $("verLabel"), v2 = $("verAbout"); if (v1) v1.textContent = "v" + version; if (v2) v2.textContent = version;
    const yr = $("yearLabel"); if (yr) yr.textContent = "2026";
    const email = "support@veloxalabs.com";
    ["supportLink", "supportLink2"].forEach((id) => { const a = $(id); if (a) a.href = "mailto:" + email; });
    const cv = $("curVer"); if (cv) cv.textContent = "v" + version;
    const rl = $("repoLink"); if (rl && window.VersionInfo) rl.href = window.VersionInfo.REPO_URL;
  })();

  // ---------- update check ----------
  function renderUpdate(info) {
    const el = $("updateStatus"), how = $("updateHow");
    if (!el) return;
    if (!info) { el.textContent = "—"; el.className = "test"; if (how) how.hidden = true; return; }
    if (info.error) { el.textContent = "couldn't check (" + info.error + ")"; el.className = "test bad"; if (how) how.hidden = true; }
    else if (info.available) { el.innerHTML = "update available → <strong>v" + esc(info.latest) + "</strong>"; el.className = "test"; el.style.color = "var(--ok)"; if (how) how.hidden = false; }
    else { el.textContent = "you're up to date"; el.className = "test ok"; if (how) how.hidden = true; }
  }
  (async () => { try { const { updateInfo } = await chrome.storage.local.get("updateInfo"); renderUpdate(updateInfo); } catch (_) {} })();
  $("checkUpdateBtn").addEventListener("click", async () => {
    const el = $("updateStatus"); el.textContent = "checking…"; el.className = "test"; el.style.color = "";
    const info = await chrome.runtime.sendMessage({ type: "CHECK_UPDATE" });
    renderUpdate(info);
  });

  function clamp(n, lo, hi, dflt) { if (isNaN(n)) return dflt; return Math.min(hi, Math.max(lo, n)); }
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  load();
})();
