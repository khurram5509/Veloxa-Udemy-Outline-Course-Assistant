(function () {
  const $ = (id) => document.getElementById(id);
  const profileSelect = $("profileSelect");
  const modelSelect = $("modelSelect");
  const fileInput = $("fileInput");
  const fileInfo = $("fileInfo");
  const analyzeBtn = $("analyzeBtn");
  const parseOllamaBtn = $("parseOllamaBtn");
  const parseBtn = $("parseBtn");
  const fillBtn = $("fillBtn");
  const fillCurrentBtn = $("fillCurrentBtn");
  const preview = $("preview");
  const statusEl = $("ollamaStatus");
  const hint = $("hint");
  const logList = $("logList");

  let docText = "";
  let currentContent = null; // the Ollama-generated content used for filling
  let settings = { ollamaUrl: "http://localhost:11434", defaultModel: "" };

  const F = {
    title: "fTitle", subtitle: "fSubtitle", description: "fDescription",
    level: "fLevel", category: "fCategory", subcategory: "fSubcategory",
    primarilyTaught: "fPrimary", objectives: "fObjectives",
    requirements: "fRequirements", audience: "fAudience",
    welcomeMessage: "fWelcome", congratulationsMessage: "fCongrats"
  };
  const ARRAY_FIELDS = ["objectives", "requirements", "audience"];

  // Normalize a directly-uploaded JSON into the content shape the filler expects.
  function normalizeJsonContent(obj, profileId) {
    obj = (obj && typeof obj === "object") ? obj : {};
    const str = (v) => (v == null ? "" : String(v)).trim();
    const arr = (v) => Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean)
      : (typeof v === "string" ? v.split(/\r?\n|;/).map((s) => s.trim()).filter(Boolean) : []);
    const curriculum = Array.isArray(obj.curriculum) ? obj.curriculum.map((s) => {
      s = s || {};
      const title = str(s.title);
      const lectures = arr(s.lectures);
      return title ? { title, lectures: lectures.length ? lectures : [title] } : null;
    }).filter(Boolean) : [];
    return {
      title: str(obj.title), subtitle: str(obj.subtitle), description: str(obj.description),
      level: str(obj.level), category: str(obj.category), subcategory: str(obj.subcategory),
      primarilyTaught: str(obj.primarilyTaught != null ? obj.primarilyTaught : obj.primarily_taught),
      objectives: arr(obj.objectives), requirements: arr(obj.requirements), audience: arr(obj.audience),
      welcomeMessage: str(obj.welcomeMessage != null ? obj.welcomeMessage : obj.welcome_message),
      congratulationsMessage: str(obj.congratulationsMessage != null ? obj.congratulationsMessage : obj.congratulations_message),
      curriculum,
      _fields: (obj._fields && typeof obj._fields === "object") ? obj._fields : {},
      _profileId: profileId, _source: "json"
    };
  }

  // ---------- init ----------
  function aiName() { return settings.provider === "openai" ? "ChatGPT" : "Ollama"; }
  function applyProviderLabels() {
    const n = aiName();
    analyzeBtn.textContent = `✨ Analyze & Improve with ${n}`;
    parseOllamaBtn.textContent = `Parse with ${n} (no improvement)`;
    const h = document.getElementById("genHint");
    if (h) h.textContent = `1 = ${n} improves & expands · 2 = ${n} maps your exact words · 3 = no AI, straight from sections.`;
  }

  async function init() {
    const store = await chrome.storage.local.get(["profiles", "settings", "generatedContent", "updateInfo"]);
    settings = Object.assign({ ollamaUrl: "http://localhost:11434", defaultModel: "" }, store.settings || {});

    const profiles = store.profiles || [];
    profileSelect.innerHTML = profiles.length
      ? profiles.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}${p.fromName ? " (from " + escapeHtml(p.fromName) + ")" : ""}</option>`).join("")
      : '<option value="">No profiles — click Manage</option>';

    applyProviderLabels();
    await loadModels();
    await checkTab();
    await refreshLogs();

    // restore previously generated content so it can be reused later
    if (store.generatedContent) {
      currentContent = store.generatedContent;
      renderPreview(currentContent);
    }
    wireCounters();
    updateButtons();

    if (store.updateInfo && store.updateInfo.available) {
      const b = $("updateBanner");
      if (b) { b.hidden = false; b.innerHTML = `⬆ Update available: <strong>v${escapeHtml(store.updateInfo.latest)}</strong> — <a href="${escapeHtml(store.updateInfo.url || "#")}" target="_blank" rel="noopener">get it on GitHub ↗</a>`; }
    }

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.logs) renderLogs(changes.logs.newValue || []);
    });
  }

  async function loadModels() {
    const openai = settings.provider === "openai";
    const name = openai ? "ChatGPT" : "Ollama";
    statusEl.textContent = "Checking " + name + "…";
    statusEl.className = "status";
    const res = await chrome.runtime.sendMessage({ type: "TEST_OLLAMA", provider: settings.provider, baseUrl: settings.ollamaUrl, openaiApiKey: settings.openaiApiKey });
    if (res && res.ok) {
      const models = res.models || [];
      modelSelect.innerHTML = models.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");
      if (settings.defaultModel && models.includes(settings.defaultModel)) modelSelect.value = settings.defaultModel;
      statusEl.textContent = name + " connected · " + models.length + " model(s)";
      statusEl.className = "status ok";
    } else {
      modelSelect.innerHTML = '<option value="">No models</option>';
      statusEl.className = "status bad";
      statusEl.textContent = (res && res.reason === "cors") ? "Ollama blocked — set OLLAMA_ORIGINS (see Settings)"
        : (res && res.reason === "nokey") ? "Add your OpenAI API key in Settings"
        : (res && res.reason === "badkey") ? "OpenAI API key rejected (Settings)"
        : name + " not reachable — check Settings";
    }
  }

  async function findManageTab() {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active && window.UrlUtils.isManageUrl(active.url)) return active;
    try {
      const all = await chrome.tabs.query({ url: ["*://*.udemy.com/*"] });
      const m = all.find((t) => window.UrlUtils.isManageUrl(t.url));
      if (m) return m;
    } catch (_) {}
    return active;
  }

  async function checkTab() {
    const tab = await findManageTab();
    const onManage = !!(tab && window.UrlUtils.isManageUrl(tab.url));
    if (!onManage) {
      hint.textContent = "Step 2 needs a Udemy course manage page (…/course/<id>/manage/…) open.";
      hint.style.color = "var(--muted)";
    } else {
      hint.textContent = "Course page detected — ready to fill.";
      hint.style.color = "var(--ok)";
    }
    return onManage;
  }

  // ---------- file ----------
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files[0];
    docText = "";
    if (!f) { fileInfo.textContent = ""; updateButtons(); return; }

    // A .json file is a ready-made content file — load it DIRECTLY (no parsing, no Ollama).
    if (/\.json$/i.test(f.name) || f.type === "application/json") {
      fileInfo.textContent = "Reading " + f.name + "…";
      try {
        const text = await f.text();
        const content = normalizeJsonContent(JSON.parse(text), profileSelect.value);
        currentContent = content;
        await chrome.storage.local.set({ generatedContent: content });
        renderPreview(content);
        preview.scrollIntoView({ behavior: "smooth", block: "nearest" });
        const secs = (content.curriculum || []).length;
        fileInfo.textContent = `${f.name} · loaded directly — review & Start auto-fill${secs ? " (" + secs + " curriculum section(s))" : ""}`;
        fileInfo.style.color = "var(--ok)";
      } catch (e) {
        currentContent = null;
        fileInfo.textContent = "Invalid JSON: " + (e.message || e);
        fileInfo.style.color = "var(--err)";
      }
      updateButtons();
      return;
    }

    fileInfo.textContent = "Reading " + f.name + "…";
    try {
      docText = (await window.Parser.parseFile(f)) || "";
      const words = docText.trim().split(/\s+/).filter(Boolean).length;
      fileInfo.textContent = `${f.name} · ${words} words will be sent to the AI`;
      fileInfo.style.color = words < 20 ? "var(--warn)" : "var(--muted)";
    } catch (e) {
      docText = "";
      fileInfo.textContent = "Could not read file: " + (e.message || e);
      fileInfo.style.color = "var(--err)";
    }
    updateButtons();
  });

  function updateButtons() {
    const ai = !!(modelSelect.value && docText.trim() && profileSelect.value);
    analyzeBtn.disabled = !ai;
    parseOllamaBtn.disabled = !ai;
    parseBtn.disabled = !(docText.trim() && profileSelect.value); // no model needed
    fillBtn.disabled = !currentContent;
    fillCurrentBtn.disabled = !currentContent;
  }
  profileSelect.addEventListener("change", updateButtons);
  modelSelect.addEventListener("change", updateButtons);

  // ---------- step 2: generate via Ollama (mode = "improve" | "extract") ----------
  let lastMode = "improve";
  async function runAnalyze(mode) {
    lastMode = mode;
    const btn = mode === "extract" ? parseOllamaBtn : analyzeBtn;
    analyzeBtn.disabled = true; parseOllamaBtn.disabled = true;
    const label = btn.textContent;
    btn.textContent = mode === "extract" ? "Parsing… (see log)" : "Analyzing… (see log)";
    const resp = await chrome.runtime.sendMessage({
      type: "ANALYZE_DOC", text: docText, profileId: profileSelect.value, model: modelSelect.value, mode
    });
    btn.textContent = label;
    if (resp && resp.ok && resp.content) {
      currentContent = resp.content;
      renderPreview(currentContent);
      preview.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    updateButtons();
  }
  analyzeBtn.addEventListener("click", () => runAnalyze("improve"));
  parseOllamaBtn.addEventListener("click", () => runAnalyze("extract"));
  $("reanalyzeBtn").addEventListener("click", () => { if (docText.trim()) runAnalyze(lastMode); });

  // ---------- option 2: parse & fill directly (no AI) ----------
  async function runParse() {
    parseBtn.disabled = true;
    const label = parseBtn.textContent;
    parseBtn.textContent = "Parsing…";
    try {
      await chrome.storage.local.set({ logs: [] });
      await window.Logger.info("Parsing document directly (no AI)…");
      const profiles = (await chrome.storage.local.get("profiles")).profiles || [];
      const profile = Object.assign({ name: "Instructor", fromName: "" }, profiles.find((p) => p.id === profileSelect.value) || {}, { id: profileSelect.value });
      const content = window.Extractor.fromDocument(docText, profile);
      currentContent = content;
      await chrome.storage.local.set({ generatedContent: content });
      renderPreview(content);
      await window.Logger.info(`Extracted ${content.objectives.length} objectives, ${content.requirements.length} requirements, ${content.audience.length} audience.`);
      if (!content.category) await window.Logger.warn("Category not detected from the document — pick it in the preview.");
      if (content.objectives.length < 4) await window.Logger.warn(`Only ${content.objectives.length} objectives found (Udemy needs at least 4) — add more in the preview.`);
      if (window.UdemyData && content.description.split(/\s+/).length < 250) await window.Logger.warn("Description is under 250 words — Udemy may require more. Edit it or use ‘Analyze & Improve’.");
      await window.Logger.success("Direct parse ready — review/edit, then Start auto-fill.");
      preview.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (e) {
      await window.Logger.error("Parse failed: " + (e.message || e));
    }
    parseBtn.textContent = label;
    updateButtons();
  }
  parseBtn.addEventListener("click", runParse);

  // ---------- step 2: fill using stored content ----------
  fillBtn.addEventListener("click", async () => {
    const onManage = await checkTab();
    if (!onManage) { hint.style.color = "var(--err)"; hint.textContent = "⚠ Open your Udemy course manage page first."; return; }
    const content = collectContent();
    await chrome.storage.local.set({ generatedContent: content });
    fillBtn.disabled = true;
    const label = fillBtn.textContent;
    fillBtn.textContent = "Filling… (see log)";
    await chrome.runtime.sendMessage({ type: "FILL_FROM_CONTENT", content });
    fillBtn.textContent = label;
    fillBtn.disabled = false;
  });

  // ---------- fill ONLY the page the user is currently on ----------
  fillCurrentBtn.addEventListener("click", async () => {
    const onManage = await checkTab();
    if (!onManage) { hint.style.color = "var(--err)"; hint.textContent = "⚠ Open your Udemy course manage page first."; return; }
    const content = collectContent();
    await chrome.storage.local.set({ generatedContent: content });
    fillCurrentBtn.disabled = true;
    const label = fillCurrentBtn.textContent;
    fillCurrentBtn.textContent = "Filling… (see log)";
    await chrome.runtime.sendMessage({ type: "FILL_CURRENT_PAGE", content });
    fillCurrentBtn.textContent = label;
    fillCurrentBtn.disabled = false;
  });

  // ---------- preview render / collect ----------
  function renderPreview(c) {
    preview.hidden = false;
    for (const [key, id] of Object.entries(F)) {
      const el = $(id);
      if (!el) continue;
      el.value = ARRAY_FIELDS.includes(key) ? (c[key] || []).join("\n") : (c[key] || "");
    }
    const cur = $("fCurriculum");
    if (cur) cur.value = (c.curriculum || []).map((s) => `${s.title} :: ${(s.lectures || []).join("; ")}`).join("\n");

    // reflect this profile's enabled/disabled fields (disabled ones are dimmed & won't be filled)
    const fmap = c._fields || {};
    const markDisabled = (id, key) => {
      const el = $(id); if (!el) return;
      const off = fmap[key] === false;
      el.disabled = off;
      const wrap = el.closest(".pfield"); if (wrap) wrap.classList.toggle("disabled", off);
    };
    for (const [key, id] of Object.entries(F)) markDisabled(id, key === "subcategory" ? "category" : key);
    markDisabled("fCurriculum", "curriculum");
    updateCounters();
  }

  function collectContent() {
    const c = Object.assign({}, currentContent || {});
    for (const [key, id] of Object.entries(F)) {
      const el = $(id);
      if (!el) continue;
      c[key] = ARRAY_FIELDS.includes(key)
        ? el.value.split("\n").map((s) => s.trim()).filter(Boolean)
        : el.value.trim();
    }
    const cur = $("fCurriculum");
    if (cur) {
      c.curriculum = cur.value.split("\n").map((line) => {
        line = line.trim(); if (!line) return null;
        const parts = line.split("::");
        const title = (parts[0] || "").trim();
        const lectures = (parts[1] || "").split(";").map((s) => s.trim()).filter(Boolean);
        return title ? { title, lectures: lectures.length ? lectures : [title] } : null;
      }).filter(Boolean);
    }
    currentContent = c;
    return c;
  }

  // ---------- live counters ----------
  function wireCounters() {
    ["fTitle", "fSubtitle", "fDescription"].forEach((id) => $(id).addEventListener("input", updateCounters));
  }
  function updateCounters() {
    const t = $("fTitle").value.length, s = $("fSubtitle").value.length;
    const w = $("fDescription").value.trim().split(/\s+/).filter(Boolean).length;
    setCount("cTitle", `${t}/60`, t > 60);
    setCount("cSubtitle", `${s}/120`, s > 120);
    setCount("cDesc", `${w} words (250–350)`, w < 250 || w > 350);
  }
  function setCount(id, text, bad) {
    const el = $(id); if (!el) return;
    el.textContent = text; el.className = "count" + (bad ? " bad" : "");
  }

  // ---------- logs ----------
  async function refreshLogs() {
    const { logs = [] } = await chrome.storage.local.get("logs");
    renderLogs(logs);
  }
  function renderLogs(logs) {
    if (!logs.length) { logList.innerHTML = '<div class="log-empty">No activity yet.</div>'; return; }
    logList.innerHTML = logs.slice(-200).map((l) => {
      const t = (l.ts || "").slice(11, 19);
      return `<div class="log-item ${l.level}"><span class="t">${t}</span><span class="m">${escapeHtml(l.msg)}</span></div>`;
    }).join("");
    logList.scrollTop = logList.scrollHeight;
  }
  $("clearLogs").addEventListener("click", async () => { await chrome.storage.local.set({ logs: [] }); renderLogs([]); });

  // ---------- nav ----------
  $("settingsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("manageProfiles").addEventListener("click", () => chrome.runtime.openOptionsPage());

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  init();
})();
