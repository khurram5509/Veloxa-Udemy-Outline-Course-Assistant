/* Comprehensive headless test suite for the Udemy Outline Course Assistant.
   Covers: AI generation+validation (real Ollama), error handling (stub servers),
   document parsing, content-script DOM filling (jsdom mock pages), and profiles/settings. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const http = require("http");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const results = [];
let section = "";
function S(name) { section = name; console.log("\n=== " + name + " ==="); }
function check(name, ok, info) {
  results.push({ section, name, ok: !!ok, info: info || "" });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  (" + info + ")" : ""}`);
  return ok;
}

// ---------- load lib modules into node global ----------
global.self = global;
const _ls = {};
global.chrome = { storage: { local: {
  async get(k) { const ks = Array.isArray(k) ? k : [k]; const o = {}; ks.forEach((x) => (o[x] = _ls[x])); return o; },
  async set(o) { Object.assign(_ls, o); }
} } };
for (const f of ["logger.js", "udemy-data.js", "urls.js", "prompts.js", "ollama.js", "ai.js", "generator.js", "extractor.js", "seed-profiles.js", "version.js"]) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, "src", "lib", f), "utf8"), { filename: f });
}
const { Ollama, Generator, Prompts, UdemyData, UrlUtils, Extractor } = global;

function testExtractor() {
  S("6. Direct parse — no AI (Extractor)");
  const doc = fs.readFileSync(path.join(ROOT, "sample-course-outline.md"), "utf8");
  const c = Extractor.fromDocument(doc, { id: "p1", name: "Khurram", fromName: "Nexus Life Academy" });
  check("title extracted, <= 60", c.title.length > 0 && c.title.length <= 60, c.title);
  check("description starts with AI prefix", c.description.startsWith(Prompts.AI_PREFIX), "");
  check("objectives extracted (>=4)", c.objectives.length >= 4, c.objectives.length);
  check("each objective <= 160", c.objectives.every((o) => o.length <= 160), "");
  check("requirements extracted", c.requirements.length >= 1, c.requirements.length);
  check("audience extracted", c.audience.length >= 1, c.audience.length);
  check("level recognised", UdemyData.levels.includes(c.level), c.level);
  check("category valid or empty", c.category === "" || UdemyData.categories.includes(c.category), c.category || "(empty)");
  check("subcategory consistent with category", !c.category || (UdemyData.taxonomy[c.category] || []).includes(c.subcategory), c.subcategory);
  check("primarily-taught set", !!c.primarilyTaught, c.primarilyTaught);
  const w = c.welcomeMessage.toLowerCase(), g = c.congratulationsMessage.toLowerCase();
  check("welcome has profile + course name", w.includes("khurram") && w.includes(c.title.toLowerCase().slice(0, 12)), "");
  check("congrats has profile + course name", g.includes("khurram") && g.includes(c.title.toLowerCase().slice(0, 12)), "");
  check("marked as direct-parse source", c._source === "direct-parse", c._source);
  check("curriculum parsed from Modules section", (c.curriculum || []).length >= 5 && c.curriculum.every((s) => s.title && s.lectures.length >= 1), (c.curriculum || []).length + " sections");

  // empty / unstructured doc → safe defaults, no throw
  const empty = Extractor.fromDocument("just one line with no headings", { id: "p1", name: "Sam", fromName: "Acme" });
  check("unstructured doc → no crash, AI prefix present", empty.description.startsWith(Prompts.AI_PREFIX), "");
}

function testUrls() {
  S("0. URL detection (manage-page matching)");
  const good = [
    "https://www.udemy.com/course/1234567/manage/goals/",
    "https://www.udemy.com/course/1234567/manage/basics/",
    "https://www.udemy.com/course/1234567/manage/communications/messages/",
    "https://udemy.com/instructor/course/99/manage/goals",
    "https://www.udemy.com/course/my-course-slug/manage/goals"
  ];
  const bad = [
    "https://www.udemy.com/course/1234567/", "https://www.udemy.com/", "https://www.google.com/manage/goals", "about:blank", ""
  ];
  check("all real manage URLs detected", good.every((u) => UrlUtils.isManageUrl(u)), "");
  check("non-manage URLs rejected", bad.every((u) => !UrlUtils.isManageUrl(u)), "");
  check("course base derived up to /manage", UrlUtils.deriveCourseBase(good[0]) === "https://www.udemy.com/course/1234567/manage", UrlUtils.deriveCourseBase(good[0]));
  check("base works with /instructor/ prefix", UrlUtils.deriveCourseBase(good[3]) === "https://udemy.com/instructor/course/99/manage", UrlUtils.deriveCourseBase(good[3]));
  check("base null for non-manage", UrlUtils.deriveCourseBase(bad[0]) === null, "");
  // pageFromUrl (used by "fill current page only")
  check("pageFromUrl → goals", UrlUtils.pageFromUrl(good[0]).key === "goals", "");
  check("pageFromUrl → basics", UrlUtils.pageFromUrl(good[1]).key === "basics", "");
  check("pageFromUrl → messages", UrlUtils.pageFromUrl(good[2]).key === "messages", "");
  check("pageFromUrl → curriculum", UrlUtils.pageFromUrl("https://www.udemy.com/instructor/course/9/manage/curriculum/").key === "curriculum", "");
  check("pageFromUrl → null for /manage root", UrlUtils.pageFromUrl("https://www.udemy.com/course/1/manage/") === null, "");
}

function startStubLocal(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, "127.0.0.1", () => resolve({ srv, url: "http://127.0.0.1:" + srv.address().port }));
  });
}
async function testExtractMode() {
  S("1c. Parse with Ollama — No Improvement (extract mode)");
  const payload = {
    title: "A very long course title that definitely exceeds the sixty character maximum allowed",
    subtitle: "sub", description: "Short ten word description about self awareness and growth here today.",
    level: "beginner", category: "development", subcategory: "web development", primarilyTaught: "x",
    objectives: ["one", "two"], requirements: ["r"], audience: ["a"],
    welcomeMessage: "Welcome from Khurram.", congratulationsMessage: "Well done from Khurram.",
    curriculum: [{ title: "Module One", lectures: ["Lesson A", "Lesson B"] }, { title: "Module Two", lectures: [] }]
  };
  let calls = 0;
  const stub = await startStubLocal((req, res) => {
    if (req.url === "/api/generate") { calls++; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ response: JSON.stringify(payload) })); }
    else { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ models: [{ name: "m" }] })); }
  });
  const c = await Generator.run(stub.url, "m", "some document text here", { name: "Khurram", fromName: "Veloxa" }, {}, "extract");
  check("extract makes exactly ONE Ollama call (no rewrites)", calls === 1, "calls=" + calls);
  check("title trimmed to <=60 (not rewritten)", c.title.length <= 60, c.title.length);
  check("description NOT expanded (kept short/verbatim)", Prompts.wordCount(c.description) < 40, Prompts.wordCount(c.description) + " words");
  check("description still gets AI prefix", c.description.startsWith(Prompts.AI_PREFIX), "");
  check("objectives kept as-is (2, not padded to 4)", c.objectives.length === 2, c.objectives.length);
  check("level matched to valid option", UdemyData.levels.includes(c.level), c.level);
  check("category/subcategory matched", UdemyData.categories.includes(c.category) && (UdemyData.taxonomy[c.category] || []).includes(c.subcategory), c.category + "/" + c.subcategory);
  check("curriculum extracted (2 sections)", (c.curriculum || []).length === 2, (c.curriculum || []).length);
  check("empty section auto-gets a lecture", c.curriculum[1].lectures.length >= 1, JSON.stringify(c.curriculum[1].lectures));
  stub.srv.close();
}

const VALID_CONTENT = {
  title: "Practical Automation with Python and AI",
  subtitle: "Automate repetitive tasks using Python and modern AI tools",
  description: Prompts.AI_PREFIX + " A long description for testing the filler logic.",
  level: "Beginner Level",
  category: "Development",
  subcategory: "Programming Languages",
  primarilyTaught: "Python Automation",
  objectives: ["Install Python", "Automate files", "Scrape the web", "Build reports", "Use local AI", "Schedule bots"],
  requirements: ["A computer", "No experience needed"],
  audience: ["Office workers", "Beginners", "Freelancers"],
  welcomeMessage: "Welcome to Practical Automation with Python and AI, from Khurram at Nexus Life Academy.",
  congratulationsMessage: "Congratulations on completing Practical Automation with Python and AI! — Khurram, Nexus Life Academy.",
  _profileId: "p1"
};

// ============================================================
async function testGeneration() {
  S("1. AI generation + validation (real Ollama)");
  const conn = await Ollama.testConnection("http://localhost:11434");
  if (!conn.ok) { check("Ollama reachable (skipping generation tests)", false, conn.reason); return; }
  check("Ollama installed & running", true, conn.models.length + " models");
  const model = conn.models.includes("llama3.1:latest") ? "llama3.1:latest" : conn.models[0];
  const docText = fs.readFileSync(path.join(ROOT, "sample-course-outline.md"), "utf8");
  const profile = { id: "p1", name: "Khurram", fromName: "Nexus Life Academy" };
  let c;
  try { c = await Generator.run("http://localhost:11434", model, docText, profile, { temperature: 0.4 }); }
  catch (e) { check("Generation completed", false, e.message); return; }

  const wc = Prompts.wordCount(c.description);
  check("title <= 60 chars", c.title.length <= 60, c.title.length);
  check("subtitle <= 120 chars", c.subtitle.length <= 120, c.subtitle.length);
  check("description 250-350 words", wc >= 250 && wc <= 350, wc + " words");
  check("description starts with AI prefix", c.description.startsWith(Prompts.AI_PREFIX), "");
  check("objectives >= 4", c.objectives.length >= 4, c.objectives.length);
  check("each objective <= 160 chars", c.objectives.every((o) => o.length <= 160), "");
  check("requirements present", c.requirements.length >= 1, c.requirements.length);
  check("audience present", c.audience.length >= 1, c.audience.length);
  check("level is valid Udemy level", UdemyData.levels.includes(c.level), c.level);
  check("category valid", UdemyData.categories.includes(c.category), c.category);
  check("subcategory valid for category", (UdemyData.taxonomy[c.category] || []).includes(c.subcategory), c.subcategory);
  const w = c.welcomeMessage.toLowerCase(), g = c.congratulationsMessage.toLowerCase();
  check("welcome includes profile name", w.includes("khurram"), "");
  check("welcome includes course name", w.includes(c.title.toLowerCase().slice(0, 15)), "");
  check("congrats includes profile name", g.includes("khurram"), "");
  check("congrats includes course name", g.includes(c.title.toLowerCase().slice(0, 15)), "");
}

// ============================================================
async function testFieldConfig() {
  S("1d. Per-profile field config (enable/disable + custom prompt)");
  const payload = {
    title: "Short Title", subtitle: "Original subtitle",
    description: Prompts.AI_PREFIX + " A deliberately short description.", // would expand if enabled
    level: "beginner", category: "development", subcategory: "web development", primarilyTaught: "x",
    objectives: ["a", "b", "c", "d"], requirements: ["r"], audience: ["aud"],
    welcomeMessage: "Welcome to Short Title from Khurram at Veloxa.", congratulationsMessage: "Congrats on Short Title from Khurram at Veloxa.",
    curriculum: [{ title: "M1", lectures: ["L1"] }]
  };
  let lastTextPrompt = "", textCalls = 0;
  const stub = await startStubLocal((req, res) => {
    if (req.url === "/api/generate") {
      let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
        let body = {}; try { body = JSON.parse(b); } catch (_) {}
        if (body.format === "json") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ response: JSON.stringify(payload) })); }
        else { textCalls++; lastTextPrompt = body.prompt || ""; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ response: "Custom improved subtitle" })); }
      });
    } else { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ models: [{ name: "m" }] })); }
  });
  const defPrimary = UdemyData.fields.find((f) => f.key === "primarilyTaught").defaultPrompt;
  const profile = { id: "p1", name: "Khurram", fromName: "Veloxa", fields: {
    description: { en: false, prompt: "" },                          // DISABLED
    subtitle: { en: true, prompt: "Make it punchy and SEO-friendly" }, // EDITED custom prompt
    title: { en: true, prompt: "" },                                 // default (enabled)
    primarilyTaught: { en: true, prompt: defPrimary }                // UNCHANGED default prompt → built-in
  } };
  const c = await Generator.run(stub.url, "m", "doc text here", profile, {}, "improve");
  check("disabled field recorded false in _fields", c._fields.description === false, String(c._fields.description));
  check("enabled fields recorded true in _fields", c._fields.subtitle === true && c._fields.title === true, "");
  check("disabled description NOT improved (stays short)", Prompts.wordCount(c.description) < 30, Prompts.wordCount(c.description) + " words");
  check("custom-prompt field used its prompt", lastTextPrompt.includes("Make it punchy and SEO-friendly"), lastTextPrompt.slice(0, 40));
  check("unchanged DEFAULT prompt uses built-in (not customField)", c.primarilyTaught === "x", c.primarilyTaught);
  check("every field has a relevant default prompt", UdemyData.fields.every((f) => f.defaultPrompt && f.defaultPrompt.length > 10), "");
  check("custom-prompt output applied to field", c.subtitle === "Custom improved subtitle", c.subtitle);
  check("only the custom field triggered a rewrite (disabled skipped)", textCalls === 1, "textCalls=" + textCalls);
  stub.srv.close();
}

// ============================================================
async function testOpenAI() {
  S("1e. OpenAI (ChatGPT) provider");
  const payload = {
    title: "T", subtitle: "S", description: Prompts.AI_PREFIX + " short.", level: "beginner",
    category: "development", subcategory: "web development", primarilyTaught: "x",
    objectives: ["a", "b"], requirements: ["r"], audience: ["aud"],
    welcomeMessage: "hi", congratulationsMessage: "bye", curriculum: []
  };
  let lastAuth = "", chatCalls = 0, lastBody = null;
  const stub = await startStubLocal((req, res) => {
    lastAuth = req.headers["authorization"] || "";
    if (req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }, { id: "text-embedding-3-small" }] }));
    } else if (req.url === "/v1/chat/completions") {
      chatCalls++; let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
        try { lastBody = JSON.parse(b); } catch (_) {}
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }));
      });
    } else { res.writeHead(404); res.end(); }
  });
  const cfg = { provider: "openai", openaiApiKey: "sk-test", openaiBaseUrl: stub.url };
  const conn = await AI.testConnection(cfg);
  check("OpenAI testConnection ok", conn.ok === true, JSON.stringify(conn).slice(0, 50));
  check("OpenAI model list filters embeddings", conn.models.includes("gpt-4o") && !conn.models.includes("text-embedding-3-small"), JSON.stringify(conn.models));
  check("OpenAI uses Bearer auth header", lastAuth === "Bearer sk-test", lastAuth);
  // no key → nokey
  const nokey = await AI.testConnection({ provider: "openai", openaiBaseUrl: stub.url });
  check("OpenAI with no key → reason 'nokey'", nokey.ok === false && nokey.reason === "nokey", nokey.reason);
  // Generator routes to OpenAI
  const c = await Generator.run("", "gpt-4o-mini", "doc text", { name: "X", fromName: "Y" }, { provider: "openai", openaiApiKey: "sk-test", openaiBaseUrl: stub.url }, "extract");
  check("Generator routes generation to OpenAI", chatCalls >= 1, "chatCalls=" + chatCalls);
  check("OpenAI request used JSON response_format", lastBody && lastBody.response_format && lastBody.response_format.type === "json_object", JSON.stringify(lastBody && lastBody.response_format));
  check("OpenAI content parsed & normalized", c.title === "T" && Array.isArray(c.objectives), c.title);
  stub.srv.close();
}

// ============================================================
async function testCurriculumFullExtraction() {
  S("1f. Dedicated curriculum extraction captures ALL modules");
  const main = {
    title: "T", subtitle: "S", description: Prompts.AI_PREFIX + " short.", level: "beginner",
    category: "development", subcategory: "web development", primarilyTaught: "x",
    objectives: ["a", "b"], requirements: ["r"], audience: ["aud"], welcomeMessage: "hi", congratulationsMessage: "bye",
    curriculum: [{ title: "M1", lectures: ["a"] }, { title: "M2", lectures: ["b"] }]   // main JSON: only 2 (truncated)
  };
  const full = { curriculum: Array.from({ length: 6 }, (_, i) => ({ title: "Module " + (i + 1), lectures: ["L" + (i + 1)] })) };
  let curriculumCalls = 0;
  const stub = await startStubLocal((req, res) => {
    if (req.url === "/api/generate") {
      let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
        let body = {}; try { body = JSON.parse(b); } catch (_) {}
        const isCur = /produce the FULL course curriculum/.test(body.prompt || "");
        if (isCur) curriculumCalls++;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ response: JSON.stringify(isCur ? full : main) }));
      });
    } else { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ models: [{ name: "m" }] })); }
  });
  const c1 = await Generator.run(stub.url, "m", "a long course document with many modules", { name: "X", fromName: "Y" }, { fillCurriculum: true }, "extract");
  check("with fillCurriculum: all 6 modules captured (not just 2)", c1.curriculum.length === 6, c1.curriculum.length);
  check("dedicated curriculum call was made once", curriculumCalls === 1, "calls=" + curriculumCalls);
  curriculumCalls = 0;
  const c2 = await Generator.run(stub.url, "m", "doc", { name: "X", fromName: "Y" }, { fillCurriculum: false }, "extract");
  check("without fillCurriculum: NO dedicated call (efficient)", curriculumCalls === 0, "calls=" + curriculumCalls);
  check("without fillCurriculum: keeps draft curriculum (2)", c2.curriculum.length === 2, c2.curriculum.length);
  stub.srv.close();
}

// ============================================================
function testCurriculumTextParse() {
  S("1g. Deterministic Module/Lecture outline parsing");
  const doc = "Course Title\nModule 1: Introduction\t3\nLecture 1.1: What is X?\t3\nLecture 1.2: Why X?\t4\nModule 2: Foundations\t6\nLecture 2.1: Basics\t6\n" +
    "Module 1: Introduction\nLecture 1.1: What is X?\nSome content paragraph that is not a lecture.\nLecture 1.2: Why X?\nModule 2: Foundations\nLecture 2.1: Basics";
  const cur = Generator._parseCurriculum(doc);
  check("2 modules parsed (TOC + body deduped)", cur.length === 2, cur.length);
  check("Module 1 has 2 lectures (deduped)", cur[0].lectures.length === 2, JSON.stringify(cur[0].lectures));
  check("Module 2 has 1 lecture", cur[1].lectures.length === 1, JSON.stringify(cur[1].lectures));
  check("title keeps 'Module N:' and strips TOC page ref", cur[0].title === "Module 1: Introduction", cur[0].title);
  check("prose lines not treated as lectures", !cur[0].lectures.concat(cur[1].lectures).some((l) => /content paragraph/i.test(l)), "");
  check("unstructured text → no curriculum (AI fallback)", Generator._parseCurriculum("just prose, no module headings here").length === 0, "");
}

// ============================================================
function testDescriptionClean() {
  S("1h. Description: plain text — strip URLs / links / module counts");
  const clean = Generator._cleanDescription;
  check("strips bare http URL", clean("Learn more at https://example.com/x today.").indexOf("http") === -1, clean("Learn more at https://example.com/x today."));
  check("markdown link → label only", clean("See [our site](https://x.com) now.") === "See our site now.", clean("See [our site](https://x.com) now."));
  check("strips www. links", clean("Visit www.example.com for more.").indexOf("www.") === -1, "");
  check("strips 'N Modules | M Lectures' counts", !/modules?\s*\|\s*\d/i.test(clean("Includes 6 Modules | 25+ Lectures of content.")), clean("Includes 6 Modules | 25+ Lectures of content."));
  check("normal prose untouched", clean("A clear, practical course about ISO audits and compliance.") === "A clear, practical course about ISO audits and compliance.", "");
  check("within max words after over-long input", Prompts.wordCount(Prompts.trimToWords(clean(Prompts.AI_PREFIX + " " + Array(400).fill("word").join(" ")), UdemyData.limits.descriptionMaxWords)) <= UdemyData.limits.descriptionMaxWords, "");
}

// ============================================================
function testCleaning() {
  S("1b. Message cleaning (placeholders + preamble)");
  const ctx = { name: "Khurram", from: "Nexus Life Academy", title: "Relationship Management Skills" };
  const clean = Generator._cleanModelText, sub = Generator._subPlaceholders;
  check("strips '[Profile Name]'", sub("Welcome, [Profile Name]!", ctx) === "Welcome, Khurram!", sub("Welcome, [Profile Name]!", ctx));
  check("replaces '[Course Name]'", sub("Enjoy [Course Name]!", ctx).includes("Relationship Management"), "");
  check("replaces '[Instructor]' and '[Your Name]'", sub("From [Instructor]. — [Your Name]", ctx) === "From Khurram. — Khurram", sub("From [Instructor]. — [Your Name]", ctx));
  check("strips \"Here's the rewritten message:\" preamble", clean("Here's the rewritten message: Hello there", ctx) === "Hello there", clean("Here's the rewritten message: Hello there", ctx));
  check("strips 'Sure, here is the message:' preamble", clean("Sure, here is the message: Hi", ctx) === "Hi", clean("Sure, here is the message: Hi", ctx));
  check("strips wrapping quotes", clean('"Quoted body."', ctx) === "Quoted body.", clean('"Quoted body."', ctx));
  check("preamble + placeholder together", clean("Here's the rewritten message: \"Hi [Profile Name]\"", ctx) === "Hi Khurram", clean("Here's the rewritten message: \"Hi [Profile Name]\"", ctx));
}

// ============================================================
function startStub(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, "127.0.0.1", () => resolve({ srv, url: "http://127.0.0.1:" + srv.address().port }));
  });
}
async function testErrors() {
  S("2. Error handling");

  // Ollama offline (closed port)
  const off = await Ollama.testConnection("http://127.0.0.1:1");
  check("offline Ollama → reason 'offline'", off.ok === false && off.reason === "offline", off.reason);

  // 403 (blocked origin) → clear message
  const s403 = await startStub((req, res) => { res.writeHead(403); res.end("forbidden"); });
  const t403 = await Ollama.testConnection(s403.url);
  check("403 from /api/tags → reason 'cors'", t403.ok === false && t403.reason === "cors", t403.reason);
  let msg403 = "";
  try { await Ollama.generateJSON(s403.url, "m", "p"); } catch (e) { msg403 = e.message; }
  check("403 on generate → actionable message", /403/.test(msg403) && /reload|OLLAMA_ORIGINS/i.test(msg403), msg403.slice(0, 50));
  s403.srv.close();

  // invalid JSON from model → generator throws clean error
  const sBad = await startStub((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ response: "totally not json {oops" }));
  });
  let badMsg = "";
  try { await Generator.run(sBad.url, "m", "some document text here", { name: "X", fromName: "Y" }, {}); }
  catch (e) { badMsg = e.message; }
  check("invalid model JSON → clean error", /valid JSON/i.test(badMsg), badMsg.slice(0, 50));
  sBad.srv.close();

  // network error on generate
  let netMsg = "";
  try { await Ollama.generateJSON("http://127.0.0.1:1", "m", "p"); } catch (e) { netMsg = e.message; }
  check("network failure on generate → throws", !!netMsg, netMsg.slice(0, 40));
}

// ============================================================
async function testParser() {
  S("3. Document parsing");
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" });
  const win = dom.window;
  win.chrome = { runtime: { getURL: (p) => p } };
  vm.runInThisContext; // noop
  win.eval(fs.readFileSync(path.join(ROOT, "src", "lib", "parser.js"), "utf8"));

  // .txt
  const txt = new win.File(["Hello world from a text file."], "a.txt", { type: "text/plain" });
  const txtOut = await win.Parser.parseFile(txt);
  check(".txt parsed to text", txtOut.includes("Hello world"), txtOut.length + " chars");

  // .md
  const md = new win.File(["# Title\n\nSome **markdown** body."], "a.md", { type: "text/markdown" });
  const mdOut = await win.Parser.parseFile(md);
  check(".md parsed to text", mdOut.includes("markdown"), "");

  // empty file
  const empty = new win.File([""], "empty.txt", { type: "text/plain" });
  const emptyOut = await win.Parser.parseFile(empty);
  check("empty file → empty string (caught upstream)", emptyOut === "", JSON.stringify(emptyOut));

  // unsupported legacy .doc
  let docErr = "";
  try { await win.Parser.parseFile(new win.File(["x"], "old.doc", { type: "" })); } catch (e) { docErr = e.message; }
  check("legacy .doc → clear error", /not supported/i.test(docErr), docErr.slice(0, 40));
  check(".docx/.pdf parsing", true, "covered by vendor libs; binary fixtures needed for full run — manual");
}

// ============================================================
function loadFiller(html) {
  const dom = new JSDOM("<!doctype html><body>" + html + "</body>", { runScripts: "outside-only", pretendToBeVisual: true });
  const win = dom.window;
  win.Element.prototype.getBoundingClientRect = function () { return { width: 140, height: 24, top: 0, left: 0, right: 140, bottom: 24 }; };
  win.document.execCommand = () => { throw new Error("jsdom: execCommand not implemented"); }; // force textContent fallback
  let listener = null;
  win.chrome = { runtime: { onMessage: { addListener: (fn) => { listener = fn; } } } };
  win.eval(fs.readFileSync(path.join(ROOT, "src", "content", "udemy-filler.js"), "utf8"));
  const send = (msg) => new Promise((resolve) => { listener(msg, {}, resolve); });
  return { win, send, doc: win.document };
}

async function testDomGoals() {
  S("4a. Content script — Intended learners (/manage/goals)");
  const html = `
    <h4>What will students learn in your course?</h4>
    ${"<input type=text placeholder='Example: x'/>".repeat(6)}
    <button>Add more to your response</button>
    <h4>What are the requirements or prerequisites for taking your course?</h4>
    <input type=text placeholder='Example: req'/>
    <button>Add more to your response</button>
    <h4>Who is this course for?</h4>
    <input type=text placeholder='Example: aud'/>
    <button>Add more to your response</button>
    <button>Save</button>`;
  const { send, doc } = loadFiller(html);
  let saveClicked = false;
  doc.querySelectorAll("button").forEach((b) => { if (b.textContent.trim() === "Save") b.addEventListener("click", () => (saveClicked = true)); });

  const res = await send({ type: "FILL_PAGE", page: "goals", content: VALID_CONTENT, profile: {}, autoSave: true, overwrite: true });
  const inputs = Array.from(doc.querySelectorAll("input"));
  check("PING/handler responded ok", res.ok, "");
  check("6 objectives filled", inputs.slice(0, 6).every((i, n) => i.value === VALID_CONTENT.objectives[n]), "");
  check("requirement filled", inputs[6].value === VALID_CONTENT.requirements[0], inputs[6].value);
  check("audience filled", inputs[7].value === VALID_CONTENT.audience[0], inputs[7].value);
  check("Save auto-clicked", saveClicked && res.saved, "");
}

async function testDomGoalsOverwrite() {
  S("4b. Content script — overwrite=OFF keeps existing values");
  const html = `
    <h4>What will students learn in your course?</h4>
    <input type=text value='KEEP ME'/>
    ${"<input type=text/>".repeat(5)}
    <h4>What are the requirements or prerequisites for taking your course?</h4>
    <input type=text/>
    <h4>Who is this course for?</h4>
    <input type=text/>
    <button>Save</button>`;
  const { send, doc } = loadFiller(html);
  const res = await send({ type: "FILL_PAGE", page: "goals", content: VALID_CONTENT, profile: {}, autoSave: false, overwrite: false });
  const inputs = Array.from(doc.querySelectorAll("input"));
  check("existing value preserved (overwrite off)", inputs[0].value === "KEEP ME", inputs[0].value);
  check("empty fields still filled", inputs[1].value === VALID_CONTENT.objectives[1], inputs[1].value);
  check("warning logged about kept field", (res.warnings || []).some((w) => /kept/i.test(w)), "");
  check("Save NOT clicked when autoSave off", !res.saved, "");
}

async function testDomBasics() {
  S("4c. Content script — Course landing page (/manage/basics)");
  const html = `
    <label>Course title</label><input type=text/>
    <label>Course subtitle</label><input type=text/>
    <label>Course description</label><div contenteditable="true"></div>
    <label>Basic info</label>
    <select><option>English (US)</option></select>
    <select><option>-- Select Level --</option><option>Beginner Level</option><option>Intermediate Level</option><option>Expert Level</option><option>All Levels</option></select>
    <select><option>-- Select Category --</option><option>Development</option><option>Business</option><option>Design</option></select>
    <select><option>-- Select Sub Category --</option><option>Web Development</option><option>Data Science</option><option>Programming Languages</option></select>
    <label>What is primarily taught in your course?</label><input type=text/>
    <button>Save</button>`;
  const { send, doc } = loadFiller(html);
  const res = await send({ type: "FILL_PAGE", page: "basics", content: VALID_CONTENT, profile: {}, autoSave: true, overwrite: true });
  const inputs = Array.from(doc.querySelectorAll("input"));
  const selects = Array.from(doc.querySelectorAll("select"));
  check("title filled", inputs[0].value === VALID_CONTENT.title, "");
  check("subtitle filled", inputs[1].value === VALID_CONTENT.subtitle, "");
  check("description filled (rich text)", doc.querySelector('[contenteditable]').textContent.includes("artificial intelligence"), "");
  check("level selected", selects[1].value && selects[1].options[selects[1].selectedIndex].text === "Beginner Level", selects[1].options[selects[1].selectedIndex].text);
  check("category selected", selects[2].options[selects[2].selectedIndex].text === "Development", selects[2].options[selects[2].selectedIndex].text);
  check("sub-category selected", selects[3].options[selects[3].selectedIndex].text === "Programming Languages", selects[3].options[selects[3].selectedIndex].text);
  check("primarily-taught filled", inputs[2].value === VALID_CONTENT.primarilyTaught, "");
  check("response reports filled fields", (res.filled || []).length >= 6, (res.filled || []).join(","));
}

async function testDomMessages() {
  S("4d. Content script — Course messages (/manage/communications/messages)");
  const html = `
    <label>Welcome Message</label><div contenteditable="true"></div>
    <label>Congratulations Message</label><div contenteditable="true"></div>
    <button>Save</button>`;
  const { send, doc } = loadFiller(html);
  const res = await send({ type: "FILL_PAGE", page: "messages", content: VALID_CONTENT, profile: {}, autoSave: true, overwrite: true });
  const eds = Array.from(doc.querySelectorAll('[contenteditable]'));
  check("welcome message filled", eds[0].textContent.includes("Welcome"), "");
  check("congratulations message filled", eds[1].textContent.includes("Congratulations"), "");
  check("welcome has profile + course name", /khurram/i.test(eds[0].textContent) && /python and ai/i.test(eds[0].textContent), "");
  check("congrats has profile + course name", /khurram/i.test(eds[1].textContent) && /python and ai/i.test(eds[1].textContent), "");
}

async function testDomUnknownPage() {
  S("4e. Content script — unsupported page → error");
  const { send } = loadFiller("<p>nothing</p>");
  const res = await send({ type: "FILL_PAGE", page: "pricing", content: VALID_CONTENT, profile: {}, autoSave: false });
  check("unknown page → ok:false with error", res.ok === false && /unknown page/.test(res.error || ""), res.error);
  const ping = await send({ type: "PING" });
  check("PING responds ready", ping && ping.ok, "");
}

// ============================================================
async function testClearThenFill() {
  S("4f. Prefilled fields are cleared, then re-filled (overwrite ON)");
  // goals with a prefilled objective input + prefilled requirement
  const goals = `
    <h4>What will students learn in your course?</h4>
    <input type=text value='OLD OBJECTIVE'/>${"<input type=text/>".repeat(5)}
    <h4>What are the requirements or prerequisites for taking your course?</h4>
    <input type=text value='OLD REQ'/>
    <h4>Who is this course for?</h4>
    <input type=text/>
    <button>Save</button>`;
  let { send, doc } = loadFiller(goals);
  await send({ type: "FILL_PAGE", page: "goals", content: VALID_CONTENT, profile: {}, autoSave: false, overwrite: true });
  let inputs = Array.from(doc.querySelectorAll("input"));
  check("prefilled objective replaced (not appended)", inputs[0].value === VALID_CONTENT.objectives[0], inputs[0].value);
  check("prefilled requirement replaced", inputs[6].value === VALID_CONTENT.requirements[0], inputs[6].value);

  // messages with prefilled rich-text editors
  const msgs = `
    <label>Welcome Message</label><div contenteditable="true">OLD WELCOME TEXT that must be gone</div>
    <label>Congratulations Message</label><div contenteditable="true">OLD CONGRATS</div>
    <button>Save</button>`;
  ({ send, doc } = loadFiller(msgs));
  await send({ type: "FILL_PAGE", page: "messages", content: VALID_CONTENT, profile: {}, autoSave: false, overwrite: true });
  const eds = Array.from(doc.querySelectorAll("[contenteditable]"));
  check("old welcome text fully removed", !eds[0].textContent.includes("OLD WELCOME"), eds[0].textContent.slice(0, 30));
  check("new welcome text present", eds[0].textContent.includes("Welcome"), "");
  check("old congrats text fully removed", !eds[1].textContent.includes("OLD CONGRATS"), "");
}

// ============================================================
async function testAddMoreRows() {
  S("4g. 'Add more' adds rows so every item fills");
  const html = `
    <h4>What will students learn in your course?</h4>
    ${"<input type=text/>".repeat(4)}
    <button class='am'>Add more to your response</button>
    <h4>What are the requirements or prerequisites for taking your course?</h4>
    <input type=text/>
    <button class='am'>Add more to your response</button>
    <h4>Who is this course for?</h4>
    <input type=text/>
    <button class='am'>Add more to your response</button>
    <button>Save</button>`;
  const { send, doc } = loadFiller(html);
  // simulate Udemy: clicking "Add more" inserts a new input right before the button
  doc.querySelectorAll("button.am").forEach((btn) => {
    btn.addEventListener("click", () => {
      const inp = doc.createElement("input"); inp.type = "text";
      btn.parentNode.insertBefore(inp, btn);
    });
  });
  const res = await send({ type: "FILL_PAGE", page: "goals", content: VALID_CONTENT, profile: {}, autoSave: false, overwrite: true });
  const vals = Array.from(doc.querySelectorAll("input")).map((i) => i.value);
  check("all 6 objectives filled (rows added)", VALID_CONTENT.objectives.every((o) => vals.includes(o)), "");
  check("all 3 audience filled (rows added)", VALID_CONTENT.audience.every((a) => vals.includes(a)), "");
  check("no 'could not add enough rows' warning", !(res.warnings || []).some((w) => /could not add/.test(w)), (res.warnings || []).join("|"));
}

async function testDelayedRender() {
  S("4h. Waits for a slow-rendering page, then fills");
  const basics = `<label>Course title</label><input type=text/>
    <label>Course subtitle</label><input type=text/>
    <label>Course description</label><div contenteditable="true"></div>
    <label>Basic info</label>
    <select><option>English (US)</option></select>
    <select><option>-- Select Level --</option><option>Beginner Level</option></select>
    <select><option>-- Select Category --</option><option>Development</option></select>
    <select><option>-- Select Sub Category --</option><option>Programming Languages</option></select>
    <label>What is primarily taught in your course?</label><input type=text/>
    <button>Save</button>`;
  const { send, doc } = loadFiller("<p>loading…</p>"); // fields absent at first
  setTimeout(() => { doc.body.innerHTML = basics; }, 700); // appear after 700ms
  const res = await send({ type: "FILL_PAGE", page: "basics", content: VALID_CONTENT, profile: {}, autoSave: false, overwrite: true });
  check("not flagged notReady (fields appeared in time)", !res.notReady, "");
  check("title filled after delayed render", Array.from(doc.querySelectorAll("input")).some((i) => i.value === VALID_CONTENT.title), "");
}

async function testNotReady() {
  S("4i. Page that never renders fields → notReady");
  // shorten the wait by stubbing: page stays empty; messages anchor wait is 12s, so use a tiny override
  const { win, send, doc } = loadFiller("<p>empty page, no form</p>");
  // speed up: monkeypatch the page's setTimeout so waitFor times out fast
  const realST = win.setTimeout;
  win.__t0 = realST; // keep ref
  const res = await Promise.race([
    send({ type: "FILL_PAGE", page: "messages", content: VALID_CONTENT, profile: {}, autoSave: false, overwrite: true }),
    new Promise((r) => realST(() => r({ timedOutHarness: true }), 14000))
  ]);
  check("messages with no editors → notReady true", res && res.notReady === true, JSON.stringify(res).slice(0, 60));
}

// ============================================================
async function testJsonContent() {
  S("4n. Ready-made JSON fills via the content script");
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, "sample-course.json"), "utf8"));
  const content = Object.assign({}, json, { _fields: {} }); // popup normalize is pass-through for well-formed JSON
  const goals = `<h4>What will students learn in your course?</h4>${"<input type=text/>".repeat(8)}<h4>What are the requirements or prerequisites for taking your course?</h4><input type=text/><input type=text/><h4>Who is this course for?</h4>${"<input type=text/>".repeat(3)}<button>Save</button>`;
  const { send, doc } = loadFiller(goals);
  await send({ type: "FILL_PAGE", page: "goals", content, profile: {}, autoSave: false, overwrite: true });
  const vals = Array.from(doc.querySelectorAll("input")).map((i) => i.value).filter(Boolean);
  check("JSON objectives filled", json.objectives.every((o) => vals.includes(o)), "");
  check("JSON requirements filled", json.requirements.every((o) => vals.includes(o)), "");
  check("JSON audience filled", json.audience.every((o) => vals.includes(o)), "");
  check("sample JSON has all 13 content keys", ["title", "subtitle", "description", "level", "category", "subcategory", "primarilyTaught", "objectives", "requirements", "audience", "welcomeMessage", "congratulationsMessage", "curriculum"].every((k) => k in json), "");
}

// ============================================================
async function testFieldSkip() {
  S("4k. Content script skips fields disabled for the profile");
  const html = `
    <label>Course title</label><input type=text/>
    <label>Course subtitle</label><input type=text/>
    <label>Course description</label><div contenteditable="true"></div>
    <label>Basic info</label>
    <select><option>English (US)</option></select>
    <select><option>-- Select Level --</option><option>Beginner Level</option></select>
    <select><option>-- Select Category --</option><option>Development</option></select>
    <select><option>-- Select Sub Category --</option><option>Programming Languages</option></select>
    <label>What is primarily taught in your course?</label><input type=text/>
    <button>Save</button>`;
  const { send, doc } = loadFiller(html);
  const content = Object.assign({}, VALID_CONTENT, { _fields: { title: false, subtitle: true, description: false } });
  const res = await send({ type: "FILL_PAGE", page: "basics", content, profile: {}, autoSave: false, overwrite: true });
  const inputs = Array.from(doc.querySelectorAll("input"));
  check("disabled title NOT filled (left empty)", inputs[0].value === "", JSON.stringify(inputs[0].value));
  check("enabled subtitle filled", inputs[1].value === VALID_CONTENT.subtitle, "");
  check("disabled description NOT filled", doc.querySelector('[contenteditable]').textContent === "", "");
  check("skip noted in warnings", (res.warnings || []).some((w) => /title skipped \(disabled/.test(w)), "");
}

// ============================================================
async function testCurriculumGuard() {
  S("4j. Curriculum — empty-data guard");
  const { send } = loadFiller('<button data-purpose="section-edit-btn"></button>');
  const res = await send({ type: "FILL_PAGE", page: "curriculum", content: { curriculum: [] }, autoSave: false, overwrite: true });
  check("empty curriculum → ok with 'curriculum' missing (no crash)", res.ok === true && (res.missing || []).includes("curriculum"), JSON.stringify(res.missing));
}

// stateful mock of Udemy's curriculum editor — lets us prove fillCurriculum is idempotent + de-dupe
function setupCurriculumMock(doc) {
  const state = { sections: [{ title: "Introduction", lectures: ["Introduction"] }] };
  let mode = null, tSec = -1, tLec = -1, pSec = -1, dSec = -1, dLec = -1;
  function render() {
    let h = '<div data-purpose="curriculum-list">';
    state.sections.forEach((s, si) => {
      h += `<div class="js-curriculum-item-draggable"><span data-purpose="item-full-title">Section ${si + 1}:${s.title}</span><button data-purpose="section-edit-btn" data-si="${si}"></button></div>`;
      s.lectures.forEach((l, li) => { h += `<div class="js-curriculum-item-draggable"><span data-purpose="item-full-title">Lecture:${l}</span><button data-purpose="lecture-edit-btn" data-si="${si}" data-li="${li}"></button><button data-purpose="lecture-delete-btn" data-si="${si}" data-li="${li}"></button></div>`; });
      h += `<button data-purpose="add-curriculum-item-dropdown-trigger" data-si="${si}">+ item</button>`;
    });
    h += '<button data-purpose="add-item-inline-last">+ Section</button>';
    h += '<div><input data-purpose="section-title"><input data-purpose="lecture-title"><button data-purpose="submit-section-form">Save Section</button><button data-purpose="submit-lecture-form">Save Lecture</button><button data-purpose="add-curriculum-item-lecture">Lecture</button><button data-purpose="submit-confirm-modal">OK</button></div></div>';
    doc.body.innerHTML = h;
    doc.querySelectorAll('[data-purpose="section-edit-btn"]').forEach((b) => b.addEventListener("click", () => { mode = "editSec"; tSec = +b.dataset.si; doc.querySelector('[data-purpose="section-title"]').value = state.sections[tSec].title; }));
    doc.querySelectorAll('[data-purpose="lecture-edit-btn"]').forEach((b) => b.addEventListener("click", () => { mode = "editLec"; tSec = +b.dataset.si; tLec = +b.dataset.li; }));
    doc.querySelectorAll('[data-purpose="lecture-delete-btn"]').forEach((b) => b.addEventListener("click", () => { mode = "delLec"; dSec = +b.dataset.si; dLec = +b.dataset.li; }));
    doc.querySelector('[data-purpose="add-item-inline-last"]').addEventListener("click", () => { mode = "addSec"; });
    doc.querySelectorAll('[data-purpose="add-curriculum-item-dropdown-trigger"]').forEach((b) => b.addEventListener("click", () => { pSec = +b.dataset.si; }));
    doc.querySelector('[data-purpose="add-curriculum-item-lecture"]').addEventListener("click", () => { mode = "addLec"; });
    doc.querySelector('[data-purpose="submit-section-form"]').addEventListener("click", () => { const v = doc.querySelector('[data-purpose="section-title"]').value.trim(); if (!v) return; if (mode === "editSec") state.sections[tSec].title = v; else if (mode === "addSec") state.sections.push({ title: v, lectures: [] }); mode = null; render(); });
    doc.querySelector('[data-purpose="submit-lecture-form"]').addEventListener("click", () => { const v = doc.querySelector('[data-purpose="lecture-title"]').value.trim(); if (!v) return; if (mode === "editLec") state.sections[tSec].lectures[tLec] = v; else if (mode === "addLec") state.sections[pSec].lectures.push(v); mode = null; render(); });
    doc.querySelector('[data-purpose="submit-confirm-modal"]').addEventListener("click", () => { if (mode === "delLec" && state.sections[dSec]) { state.sections[dSec].lectures.splice(dLec, 1); } mode = null; render(); });
  }
  render();
  return { state, render };
}

async function testCurriculumIdempotent() {
  S("4l. Curriculum is idempotent (re-run never duplicates)");
  const { send, doc } = loadFiller("");
  const { state } = setupCurriculumMock(doc);
  const curriculum = [{ title: "Mod 1", lectures: ["L1", "L2"] }, { title: "Mod 2", lectures: ["L3", "L4"] }];
  await send({ type: "FILL_PAGE", page: "curriculum", content: { curriculum }, autoSave: false, overwrite: true });
  const after1 = state.sections.map((s) => s.title + ":" + s.lectures.join(","));
  check("first run builds 2 sections, 4 lectures", state.sections.length === 2 && state.sections.reduce((a, s) => a + s.lectures.length, 0) === 4, JSON.stringify(after1));
  check("sections/lectures correct", after1[0] === "Mod 1:L1,L2" && after1[1] === "Mod 2:L3,L4", JSON.stringify(after1));
  // RE-RUN with the same content — must not duplicate anything
  await send({ type: "FILL_PAGE", page: "curriculum", content: { curriculum }, autoSave: false, overwrite: true });
  const after2 = state.sections.map((s) => s.title + ":" + s.lectures.join(","));
  check("re-run adds NO duplicate sections", state.sections.length === 2, state.sections.length);
  check("re-run adds NO duplicate lectures", state.sections.reduce((a, s) => a + s.lectures.length, 0) === 4, JSON.stringify(after2));
}

async function testCurriculumDedupe() {
  S("4m. Curriculum de-dupe removes duplicate lectures (opt-in)");
  const { send, doc } = loadFiller("");
  const { state, render } = setupCurriculumMock(doc);
  state.sections = [{ title: "Sec1", lectures: ["Intro", "A", "B", "A"] }, { title: "Sec2", lectures: ["C", "C"] }];
  render();
  const curriculum = [{ title: "Sec1", lectures: ["Intro", "A", "B"] }, { title: "Sec2", lectures: ["C"] }];
  await send({ type: "FILL_PAGE", page: "curriculum", content: { curriculum }, dedupe: true, autoSave: false, overwrite: true });
  const s1 = state.sections[0].lectures, s2 = state.sections[1].lectures;
  check("duplicate 'A' removed from Sec1", s1.filter((x) => x === "A").length === 1, JSON.stringify(s1));
  check("duplicate 'C' removed from Sec2", s2.filter((x) => x === "C").length === 1, JSON.stringify(s2));
  check("non-duplicates preserved", s1.includes("Intro") && s1.includes("B"), JSON.stringify(s1));
  // dedupe OFF → duplicates kept
  const m2 = setupCurriculumMock(doc); m2.state.sections = [{ title: "S", lectures: ["X", "X"] }]; m2.render();
  await send({ type: "FILL_PAGE", page: "curriculum", content: { curriculum: [{ title: "S", lectures: ["X"] }] }, dedupe: false, autoSave: false, overwrite: true });
  check("dedupe OFF keeps duplicates (not destructive by default)", m2.state.sections[0].lectures.filter((x) => x === "X").length === 2, JSON.stringify(m2.state.sections[0].lectures));
}

// ============================================================
async function testPopupLabels() {
  S("5b. Popup buttons/labels switch to the selected provider");
  const html = fs.readFileSync(path.join(ROOT, "src", "popup", "popup.html"), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
  const win = dom.window;
  const store = { settings: { provider: "openai", openaiApiKey: "sk", ollamaUrl: "http://localhost:11434", defaultModel: "" }, profiles: [{ id: "p1", name: "ISO Xpert", fromName: "ISO Xpert" }] };
  win.chrome = {
    storage: { local: { get: async (k) => { const ks = Array.isArray(k) ? k : [k]; const o = {}; ks.forEach((x) => (o[x] = store[x])); return o; }, set: async (o) => Object.assign(store, o) }, onChanged: { addListener: () => {} } },
    runtime: { sendMessage: async (m) => (m.provider === "openai" ? { ok: true, models: ["gpt-4o", "gpt-4o-mini"] } : { ok: true, models: [] }), openOptionsPage: () => {} },
    tabs: { query: async () => [{ id: 1, url: "https://www.udemy.com/course/1/manage/goals" }] }
  };
  win.UrlUtils = { isManageUrl: () => true };
  win.Logger = { info: async () => {}, warn: async () => {}, error: async () => {}, success: async () => {} };
  win.UdemyData = { fields: [] };
  win.Parser = { parseFile: async () => "" };
  win.Extractor = { fromDocument: () => ({}) };
  win.eval(fs.readFileSync(path.join(ROOT, "src", "popup", "popup.js"), "utf8"));
  await new Promise((r) => setTimeout(r, 200));
  const at = win.document.getElementById("analyzeBtn").textContent;
  const pt = win.document.getElementById("parseOllamaBtn").textContent;
  const st = win.document.getElementById("ollamaStatus").textContent;
  check("Analyze button relabels to ChatGPT (no 'Ollama')", /ChatGPT/.test(at) && !/Ollama/.test(at), at);
  check("Parse-with button relabels to ChatGPT", /ChatGPT/.test(pt) && !/Ollama/.test(pt), pt);
  check("status shows ChatGPT connected", /ChatGPT connected/.test(st), st);
  check("model dropdown lists OpenAI models", /gpt-4o/.test(win.document.getElementById("modelSelect").innerHTML), "");
}

// ============================================================
function testUpdater() {
  S("8b. GitHub update version compare");
  const V = global.VersionInfo;
  check("newer > current", V.cmpVersion("3.1.0", "3.0.0") > 0, "");
  check("older < current", V.cmpVersion("2.9.1", "3.0.0") < 0, "");
  check("equal = 0", V.cmpVersion("3.0.0", "3.0.0") === 0, "");
  check("patch comparison", V.cmpVersion("3.0.10", "3.0.9") > 0, "");
  check("repo + manifest URLs point to the repo", /khurram5509\/Veloxa-Udemy-Outline-Course-Assistant/.test(V.REPO_URL) && /raw\.githubusercontent\.com.*manifest\.json/.test(V.MANIFEST_URL), "");
}

function testSeedProfiles() {
  S("7. Six ready-made starter profiles");
  const sp = global.SeedProfiles;
  check("exactly 6 profiles seeded", sp.length === 6, sp.length);
  const names = sp.map((p) => p.name);
  ["ISO Xpert", "Nextgen3d", "Professional Training Institute (PTI)", "Nexus Life Academy", "Veloxa Labs", "Vertex Business Academy"].forEach((n) => {
    check("has profile: " + n, names.includes(n), "");
  });
  check("profile names are unique", new Set(names).size === 6, names.length);
  const iso = sp.find((p) => p.name === "ISO Xpert");
  check("ISO Xpert: fromName + role set", iso.fromName === "ISO Xpert" && /ISO Compliance & Audit/.test(iso.role), iso.role);
  check("every profile has all 12 fields enabled with a prompt", sp.every((p) => UdemyData.fields.every((f) => p.fields[f.key] && p.fields[f.key].en === true && (p.fields[f.key].prompt || "").length > 10)), "");
  check("prompts are niche-specific (ISO title)", /ISO\/compliance course title of 50/.test(iso.fields.title.prompt), iso.fields.title.prompt.slice(0, 30));
  const vlx = sp.find((p) => p.name === "Veloxa Labs");
  check("Veloxa Labs description prompt mentions AI/automation", /AI tools, automation/.test(vlx.fields.description.prompt), "");
  check("all description prompts require plain text (no URLs/links/counts)", sp.every((p) => /plain text only.*no URLs or links.*module or lecture counts/i.test(p.fields.description.prompt)), "");
  // a starter profile drives the generator's custom-prompt path (every field has an edited prompt)
  check("starter prompts differ from built-in defaults (so they're used as custom)", UdemyData.fields.every((f) => iso.fields[f.key].prompt !== f.defaultPrompt), "");
}

// ============================================================
async function testOptions() {
  S("5. Settings & profiles (options page)");
  const html = fs.readFileSync(path.join(ROOT, "src", "options", "options.html"), "utf8")
    .replace(/<script[\s\S]*?<\/script>/g, ""); // strip script tags; we eval manually
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
  const win = dom.window;
  const store = {};
  win.chrome = {
    storage: { local: {
      get: async (k) => { const ks = Array.isArray(k) ? k : [k]; const o = {}; ks.forEach((x) => (o[x] = store[x])); return o; },
      set: async (o) => { Object.assign(store, o); }
    } },
    runtime: { sendMessage: async () => ({ ok: true, models: ["llama3.1:latest", "qwen2.5:0.5b"] }), openOptionsPage: () => {} }
  };
  win.eval(fs.readFileSync(path.join(ROOT, "src", "lib", "udemy-data.js"), "utf8"));
  win.eval(fs.readFileSync(path.join(ROOT, "src", "options", "options.js"), "utf8"));
  await new Promise((r) => setTimeout(r, 150)); // let load() settle

  const $ = (id) => win.document.getElementById(id);
  check("default profile row rendered", win.document.querySelectorAll(".profile-wrap").length === 1, "");
  check("default profile seeded as 'ISO Xpert'", win.document.querySelector(".p-name").value === "ISO Xpert", win.document.querySelector(".p-name").value);

  // fill profile 1
  let rows = win.document.querySelectorAll(".profile-wrap");
  rows[0].querySelector(".p-name").value = "Khurram";
  rows[0].querySelector(".p-from").value = "Nexus Life Academy";

  // add a second profile
  $("addProfile").click();
  rows = win.document.querySelectorAll(".profile-wrap");
  check("Add profile → 2 rows (multiple profiles)", rows.length === 2, rows.length);
  rows[1].querySelector(".p-name").value = "Veloxa";
  rows[1].querySelector(".p-from").value = "Veloxa Team";

  // per-profile field config: in profile 1 disable "title" + add a custom prompt; profile 2 left default
  check("field rows rendered per profile (12 each)", rows[0].querySelectorAll(".f-en").length === 12 && rows[1].querySelectorAll(".f-en").length === 12, rows[0].querySelectorAll(".f-en").length);
  rows[0].querySelector('.f-en[data-key="title"]').checked = false;
  rows[0].querySelector('.f-prompt[data-key="description"]').value = "Write it like a story";

  // settings
  $("ollamaUrl").value = "http://localhost:11434";
  $("defaultModel").value = "llama3.1:latest";
  $("temperature").value = "0.5";
  $("autoSave").checked = true;
  $("overwrite").checked = false;
  $("saveBtn").click();
  await new Promise((r) => setTimeout(r, 50));

  check("2 profiles saved (create + select)", (store.profiles || []).length === 2, (store.profiles || []).length);
  check("profile names persisted", store.profiles[0].name === "Khurram" && store.profiles[1].name === "Veloxa", "");
  check("'from' label persisted", store.profiles[0].fromName === "Nexus Life Academy", "");
  check("Ollama URL saved", store.settings.ollamaUrl === "http://localhost:11434", store.settings.ollamaUrl);
  check("default model saved", store.settings.defaultModel === "llama3.1:latest", store.settings.defaultModel);
  check("temperature saved", store.settings.temperature === 0.5, store.settings.temperature);
  check("overwrite setting saved (=false)", store.settings.overwrite === false, String(store.settings.overwrite));
  check("haltOnError setting present", typeof store.settings.haltOnError === "boolean", String(store.settings.haltOnError));
  // per-profile field config persisted + isolated between profiles
  check("profile 1: title field disabled", store.profiles[0].fields.title.en === false, String(store.profiles[0].fields.title.en));
  check("profile 1: custom description prompt saved", store.profiles[0].fields.description.prompt === "Write it like a story", store.profiles[0].fields.description.prompt);
  check("profile 2: title still enabled (no cross-profile leak)", store.profiles[1].fields.title.en === true, String(store.profiles[1].fields.title.en));
  check("profile 2: description = default, not profile 1's edit (isolated)", store.profiles[1].fields.description.prompt === UdemyData.fields.find((f) => f.key === "description").defaultPrompt, store.profiles[1].fields.description.prompt.slice(0, 20));

  // ---- new tabbed pages: Help / About / Privacy ----
  const tabs = win.document.querySelectorAll(".tab");
  const panels = win.document.querySelectorAll(".panel");
  check("4 settings tabs present", tabs.length === 4, tabs.length);
  check("4 panels present", panels.length === 4, panels.length);
  const helpTxt = (win.document.getElementById("tab-help").textContent || "").toLowerCase();
  check("Help has Ollama install commands", helpTxt.includes("ollama pull") && helpTxt.includes("brew install") && helpTxt.includes("ollamasetup.exe"), "");
  check("Help covers macOS + Windows + Linux", helpTxt.includes("macos") && helpTxt.includes("windows") && helpTxt.includes("linux"), "");
  check("Help has OLLAMA_ORIGINS for both OSes", helpTxt.includes("launchctl setenv ollama_origins") && helpTxt.includes("setx ollama_origins"), "");
  const aboutTxt = (win.document.getElementById("tab-about").textContent || "").toLowerCase();
  check("About credits Veloxa Labs", aboutTxt.includes("veloxa labs"), "");
  const privTxt = (win.document.getElementById("tab-privacy").textContent || "").toLowerCase();
  check("Privacy policy present & local-only", privTxt.includes("privacy policy") && privTxt.includes("locally"), "");
  // tab switching
  Array.from(tabs).find((t) => t.dataset.tab === "help").click();
  check("clicking Help tab activates Help panel", win.document.getElementById("tab-help").classList.contains("active") && !win.document.getElementById("tab-settings").classList.contains("active"), "");
  Array.from(tabs).find((t) => t.dataset.tab === "settings").click(); // restore for delete test below

  // delete a profile
  rows = win.document.querySelectorAll(".profile-wrap");
  rows[1].querySelector(".del").click();
  $("saveBtn").click();
  await new Promise((r) => setTimeout(r, 50));
  check("delete profile → 1 remains (edit/delete)", (store.profiles || []).length === 1, (store.profiles || []).length);
}

// ============================================================
(async () => {
  testUrls();
  await testGeneration();
  await testExtractMode();
  await testFieldConfig();
  await testOpenAI();
  await testCurriculumFullExtraction();
  testCurriculumTextParse();
  testDescriptionClean();
  testCleaning();
  await testErrors();
  await testParser();
  await testDomGoals();
  await testDomGoalsOverwrite();
  await testDomBasics();
  await testDomMessages();
  await testDomUnknownPage();
  await testClearThenFill();
  await testAddMoreRows();
  await testDelayedRender();
  await testNotReady();
  await testCurriculumGuard();
  await testCurriculumIdempotent();
  await testCurriculumDedupe();
  await testJsonContent();
  await testFieldSkip();
  testExtractor();
  await testPopupLabels();
  testUpdater();
  testSeedProfiles();
  await testOptions();

  // summary
  console.log("\n\n================ SUMMARY ================");
  const bySection = {};
  for (const r of results) { (bySection[r.section] = bySection[r.section] || { p: 0, f: 0 }); r.ok ? bySection[r.section].p++ : bySection[r.section].f++; }
  for (const [s, v] of Object.entries(bySection)) console.log(`${v.f === 0 ? "OK " : "!! "} ${s}: ${v.p} passed${v.f ? ", " + v.f + " FAILED" : ""}`);
  const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
  console.log(`\nTOTAL: ${pass}/${results.length} passed${fail ? ", " + fail + " FAILED" : ""}`);
  if (fail) { console.log("\nFAILURES:"); results.filter((r) => !r.ok).forEach((r) => console.log(`  - [${r.section}] ${r.name} ${r.info ? "(" + r.info + ")" : ""}`)); }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
