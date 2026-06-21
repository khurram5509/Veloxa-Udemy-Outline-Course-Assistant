/* Service worker: orchestrates generation (Ollama) + filling across the 3 manage pages. */
importScripts(
  "lib/logger.js",
  "lib/udemy-data.js",
  "lib/urls.js",
  "lib/prompts.js",
  "lib/ollama.js",
  "lib/ai.js",
  "lib/generator.js",
  "lib/seed-profiles.js",
  "lib/version.js"
);

// ---------- GitHub update check (unpacked extensions can't self-install, so we detect + prompt) ----------
async function checkForUpdate() {
  const current = chrome.runtime.getManifest().version;
  try {
    const r = await fetch(VersionInfo.MANIFEST_URL + "?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const remote = await r.json();
    const latest = remote.version || current;
    const available = VersionInfo.cmpVersion(latest, current) > 0;
    const info = { checkedAt: Date.now(), current, latest, available, url: VersionInfo.REPO_URL };
    await chrome.storage.local.set({ updateInfo: info });
    try { await chrome.action.setBadgeText({ text: available ? "↑" : "" }); await chrome.action.setBadgeBackgroundColor({ color: "#15803d" }); } catch (_) {}
    return info;
  } catch (e) {
    const info = { checkedAt: Date.now(), current, error: String(e && e.message || e) };
    await chrome.storage.local.set({ updateInfo: info });
    return info;
  }
}
async function maybeAutoCheck() {
  const s = await getSettings();
  if (s.autoUpdateCheck !== false) await checkForUpdate();
}
chrome.runtime.onInstalled.addListener(() => { try { chrome.alarms.create("update-check", { periodInMinutes: 720 }); } catch (_) {} maybeAutoCheck(); });
if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(maybeAutoCheck);
if (chrome.alarms && chrome.alarms.onAlarm) chrome.alarms.onAlarm.addListener((a) => { if (a.name === "update-check") maybeAutoCheck(); });

const DEFAULTS = { provider: "ollama", ollamaUrl: "http://localhost:11434", openaiApiKey: "", defaultModel: "", temperature: 0.4, autoSave: true, overwrite: true, haltOnError: true, fillCurriculum: false, dedupeCurriculum: false, autoUpdateCheck: true };

// Seed the 6 ready-made instructor profiles on install/update if the user has none yet.
async function ensureDefaultProfile() {
  try {
    const { profiles } = await chrome.storage.local.get("profiles");
    if (!profiles || !profiles.length) {
      const seed = (typeof SeedProfiles !== "undefined" && SeedProfiles.length) ? SeedProfiles : [{ id: "iso-xpert", name: "ISO Xpert", fromName: "ISO Xpert", role: "", fields: {} }];
      await chrome.storage.local.set({ profiles: JSON.parse(JSON.stringify(seed)) });
    }
  } catch (_) {}
}
chrome.runtime.onInstalled.addListener(ensureDefaultProfile);
chrome.runtime.onStartup && chrome.runtime.onStartup.addListener(ensureDefaultProfile);

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return Object.assign({}, DEFAULTS, settings || {});
}

function deriveCourseBase(url) { return UrlUtils.deriveCourseBase(url); }

function pageFromUrl(url) { return UrlUtils.pageFromUrl(url); }

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Find the Udemy "…/manage/…" tab: prefer the active tab, else any Udemy manage tab in any window.
async function findManageTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active && UrlUtils.isManageUrl(active.url)) return active;
  try {
    const all = await chrome.tabs.query({ url: ["*://*.udemy.com/*"] });
    const m = all.find((t) => UrlUtils.isManageUrl(t.url));
    if (m) return m;
  } catch (_) {}
  return active;
}

function navigateAndWait(tabId, url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error("Timed out loading " + url)); }, 30000);
    function listener(id, info) {
      if (id === tabId && info.status === "complete") { cleanup(); resolve(); }
    }
    function cleanup() { clearTimeout(timeout); chrome.tabs.onUpdated.removeListener(listener); }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url }).catch((e) => { cleanup(); reject(e); });
  });
}

async function pingContent(tabId, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: "PING" });
      if (res && res.ok) return true;
    } catch (_) {}
    await sleep(400);
  }
  return false;
}

// Make sure the filler is present: try PING, else inject it programmatically (works for any
// Udemy URL shape, even if the declarative content_scripts match misses).
async function ensureContentScript(tabId) {
  if (await pingContent(tabId, 6)) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["src/content/udemy-filler.js"] });
    await Logger.info("Injected content script (fallback).");
  } catch (e) {
    await Logger.warn("Could not inject content script: " + (e && e.message || e));
  }
  return await pingContent(tabId, 12);
}

async function sendToTab(tabId, message) {
  try { return await chrome.tabs.sendMessage(tabId, message); }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

// Step 1: send the document to Ollama and get all content back (no filling).
// mode: "improve" (rewrite for quality) | "extract" (verbatim, no improvement)
async function analyzeDoc(payload) {
  const { text, profileId, model } = payload;
  const mode = payload.mode === "extract" ? "extract" : "improve";
  await Logger.clear();
  await chrome.storage.local.set({ job: { status: "analyzing", startedAt: Date.now() } });

  const settings = await getSettings();
  const { profiles = [] } = await chrome.storage.local.get("profiles");
  const profile = profiles.find((p) => p.id === profileId) || { name: "ISO Xpert", fromName: "ISO Xpert" };
  await Logger.info(`${mode === "extract" ? "Parsing (no improvement)" : "Analyzing"} document with Ollama — profile "${profile.name}", model "${model}".`);

  let content;
  try {
    content = await Generator.run(settings.ollamaUrl, model, text, profile, settings, mode);
  } catch (e) {
    await Logger.error("Analysis failed: " + e.message);
    await chrome.storage.local.set({ job: { status: "error", error: e.message, finishedAt: Date.now() } });
    throw e;
  }
  content._profileId = profileId;
  await chrome.storage.local.set({ generatedContent: content, job: { status: "analyzed", finishedAt: Date.now() } });
  await Logger.success("Content ready — review/edit it, then click Start auto-fill.");
  return content;
}

// Step 2: fill the 3 pages using ONLY the already-generated (optionally edited) content.
async function fillPages(payload) {
  let content = payload && payload.content;
  if (!content) content = (await chrome.storage.local.get("generatedContent")).generatedContent;
  if (!content) throw new Error("No analyzed content yet — click ‘Analyze & Improve’ first.");
  await chrome.storage.local.set({ generatedContent: content }); // persist edits

  const settings = await getSettings();
  const { profiles = [] } = await chrome.storage.local.get("profiles");
  const profile = profiles.find((p) => p.id === content._profileId) || { name: "ISO Xpert", fromName: "ISO Xpert" };

  const tab = await findManageTab();
  if (!tab || !tab.id) throw new Error("No active tab.");
  const base = deriveCourseBase(tab.url);
  if (!base) throw new Error("Open your Udemy course management page first (…/manage/...).");
  if (tab.id) { try { await chrome.tabs.update(tab.id, { active: true }); } catch (_) {} }
  await Logger.info("Filling course: " + base);

  // fill each page in order
  const pages = [
    { key: "goals", url: base + "/goals/", label: "Intended learners" },
    { key: "basics", url: base + "/basics/", label: "Course landing page" },
    { key: "messages", url: base + "/communications/messages/", label: "Course messages" }
  ];
  // Curriculum is only filled when explicitly enabled in Settings (it creates sections/lectures).
  if (settings.fillCurriculum) pages.push({ key: "curriculum", url: base + "/curriculum/", label: "Curriculum" });

  const haltOnError = settings.haltOnError !== false; // "don't change page until current is done & verified"
  const results = {};
  let halted = false;

  // fill one page once; returns the content-script response (or an error-shaped object)
  async function attempt(pg) {
    await navigateAndWait(tab.id, pg.url);
    await sleep(1000); // let the SPA start rendering after load
    const ready = await ensureContentScript(tab.id);
    if (!ready) return { ok: false, error: "content script not ready (could not inject)" };
    return await sendToTab(tab.id, {
      type: "FILL_PAGE", page: pg.key, content, profile,
      autoSave: settings.autoSave, overwrite: settings.overwrite !== false, dedupe: settings.dedupeCurriculum === true
    });
  }

  for (const pg of pages) {
    await chrome.storage.local.set({ job: { status: "running", phase: "filling:" + pg.key, startedAt: Date.now() } });
    await Logger.info(`→ ${pg.label}: navigating…`);
    let res;
    try {
      res = await attempt(pg);
      // verify: a page "worked" only if it filled at least one field
      let filledCount = (res && res.filled || []).length;
      if ((!res || !res.ok || filledCount === 0) && haltOnError) {
        const why = res && res.notReady ? "page hadn't finished loading" : (res && res.error) || "no matching fields found";
        await Logger.warn(`${pg.label}: nothing filled (${why}) — retrying once…`);
        await sleep(2500);
        res = await attempt(pg);
        filledCount = (res && res.filled || []).length;
      }
      results[pg.key] = res;

      if (res && res.ok && filledCount > 0) {
        await Logger.success(`${pg.label}: filled ${filledCount} field(s)${res.saved ? " + saved" : ""}.`);
        (res.warnings || []).forEach((w) => Logger.warn(`${pg.label}: ${w}`));
        if ((res.missing || []).length) await Logger.warn(`${pg.label}: not found → ${res.missing.join(", ")}`);
      } else {
        const why = !res ? "no response" : res.notReady ? "the page did not finish loading in time" : res.error ? res.error : `no fields matched${(res.missing || []).length ? " (" + res.missing.join(", ") + ")" : ""}`;
        await Logger.error(`${pg.label}: could not fill — ${why}.`);
        if (haltOnError) {
          await Logger.error(`Stopped before the next page (verify-before-continue is ON). Fix “${pg.label}”, then run again — or turn the option off in Settings to continue past failures.`);
          halted = true;
          break;
        }
      }
    } catch (e) {
      results[pg.key] = { ok: false, error: e.message };
      await Logger.error(`${pg.label}: ${e.message}`);
      if (haltOnError) { halted = true; break; }
    }
  }

  const okCount = Object.values(results).filter((r) => r && r.ok && (r.filled || []).length > 0).length;
  await chrome.storage.local.set({ job: { status: halted ? "error" : "done", finishedAt: Date.now(), results } });
  if (halted) await Logger.error(`Stopped — ${okCount}/${pages.length} pages completed before an error.`);
  else await Logger.success(`Done — ${okCount}/${pages.length} pages completed.`);
  return { ok: !halted, results };
}

// Fill ONLY the page the user is currently on (no navigation).
async function fillCurrentPage(payload) {
  let content = payload && payload.content;
  if (!content) content = (await chrome.storage.local.get("generatedContent")).generatedContent;
  if (!content) throw new Error("No content yet — generate it first.");
  await chrome.storage.local.set({ generatedContent: content });

  const settings = await getSettings();
  const { profiles = [] } = await chrome.storage.local.get("profiles");
  const profile = profiles.find((p) => p.id === content._profileId) || { name: "ISO Xpert", fromName: "ISO Xpert" };

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !UrlUtils.isManageUrl(tab.url)) throw new Error("Open a Udemy course manage page (…/manage/…) first.");
  const pg = pageFromUrl(tab.url);
  if (!pg) throw new Error("This page isn't one of the 3 fillable pages (Goals, Landing, or Messages).");

  await Logger.clear();
  await Logger.info(`Filling current page only → ${pg.label}…`);
  const ready = await ensureContentScript(tab.id);
  if (!ready) { await Logger.error(`${pg.label}: content script not ready.`); return { ok: false }; }
  const res = await sendToTab(tab.id, {
    type: "FILL_PAGE", page: pg.key, content, profile,
    autoSave: settings.autoSave, overwrite: settings.overwrite !== false, dedupe: settings.dedupeCurriculum === true
  });
  const filledCount = (res && res.filled || []).length;
  if (res && res.ok && filledCount > 0) {
    await Logger.success(`${pg.label}: filled ${filledCount} field(s)${res.saved ? " + saved" : ""}.`);
    (res.warnings || []).forEach((w) => Logger.warn(`${pg.label}: ${w}`));
    if ((res.missing || []).length) await Logger.warn(`${pg.label}: not found → ${res.missing.join(", ")}`);
  } else {
    const why = !res ? "no response" : res.notReady ? "the page did not finish loading" : res.error || "no fields matched";
    await Logger.error(`${pg.label}: could not fill — ${why}.`);
  }
  await chrome.storage.local.set({ job: { status: "done", finishedAt: Date.now() } });
  return { ok: !!(res && res.ok && filledCount > 0), page: pg.key, result: res };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "TEST_OLLAMA") {
        const s = await getSettings();
        // the popup/options can pass live (unsaved) form values to test against
        const cfg = AI.cfgFrom({
          provider: msg.provider || s.provider,
          ollamaUrl: msg.baseUrl || s.ollamaUrl,
          openaiApiKey: msg.openaiApiKey != null ? msg.openaiApiKey : s.openaiApiKey
        });
        sendResponse(await AI.testConnection(cfg));
      } else if (msg.type === "ANALYZE_DOC") {
        const content = await analyzeDoc(msg);
        sendResponse({ ok: true, content });
      } else if (msg.type === "FILL_FROM_CONTENT") {
        const r = await fillPages(msg);
        sendResponse(r);
      } else if (msg.type === "FILL_CURRENT_PAGE") {
        const r = await fillCurrentPage(msg);
        sendResponse(r);
      } else if (msg.type === "CHECK_UPDATE") {
        sendResponse(await checkForUpdate());
      } else {
        sendResponse({ ok: false, error: "unknown message" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
  })();
  return true; // async response
});

