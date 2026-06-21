/* Node test harness: loads the real lib files and runs the generation+validation
   pipeline against the local Ollama, then asserts every project rule. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// --- browser shims ---
global.self = global;
const _store = {};
global.chrome = {
  storage: { local: {
    async get(keys) {
      const ks = Array.isArray(keys) ? keys : [keys];
      const out = {}; ks.forEach((k) => (out[k] = _store[k])); return out;
    },
    async set(obj) { Object.assign(_store, obj); }
  } }
};

const root = path.join(__dirname, "src", "lib");
for (const f of ["logger.js", "udemy-data.js", "prompts.js", "ollama.js", "ai.js", "generator.js"]) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), "utf8"), { filename: f });
}

(async () => {
  const baseUrl = "http://localhost:11434";
  const model = process.argv[2] || "llama3.1:latest";
  const docText = fs.readFileSync(path.join(__dirname, "sample-course-outline.md"), "utf8");
  const profile = { id: "p1", name: "Khurram", fromName: "The Veloxa Academy", role: "Lead Instructor" };

  console.log(`\n=== Generating with model: ${model} ===\n`);
  const t0 = Date.now();
  const c = await global.Generator.run(baseUrl, model, docText, profile, { temperature: 0.4, autoSave: true });
  console.log(`\n=== Generated in ${((Date.now() - t0) / 1000).toFixed(1)}s ===\n`);
  console.log(JSON.stringify(c, null, 2));

  // --- assertions ---
  const D = global.UdemyData, P = global.Prompts;
  const wc = P.wordCount(c.description);
  const checks = [
    ["title <= 60", c.title.length <= 60, `${c.title.length}`],
    ["subtitle <= 120", c.subtitle.length <= 120, `${c.subtitle.length}`],
    ["description 250-350 words", wc >= 250 && wc <= 350, `${wc} words`],
    ["description AI prefix", c.description.startsWith(P.AI_PREFIX), c.description.slice(0, 40)],
    ["objectives >= 4", c.objectives.length >= 4, `${c.objectives.length}`],
    ["each objective <= 160", c.objectives.every((o) => o.length <= 160), ""],
    ["requirements >= 1", c.requirements.length >= 1, `${c.requirements.length}`],
    ["audience >= 1", c.audience.length >= 1, `${c.audience.length}`],
    ["level valid", D.levels.includes(c.level), c.level],
    ["category valid", D.categories.includes(c.category), c.category],
    ["subcategory valid", (D.taxonomy[c.category] || []).includes(c.subcategory), c.subcategory],
    ["welcome mentions course", c.welcomeMessage.toLowerCase().includes(c.title.toLowerCase()), ""],
    ["welcome mentions profile", c.welcomeMessage.toLowerCase().includes("khurram"), ""],
    ["welcome mentions from", c.welcomeMessage.toLowerCase().includes("veloxa"), ""],
    ["congrats mentions course", c.congratulationsMessage.toLowerCase().includes(c.title.toLowerCase()), ""],
    ["congrats mentions profile", c.congratulationsMessage.toLowerCase().includes("khurram"), ""],
    ["congrats mentions from", c.congratulationsMessage.toLowerCase().includes("veloxa"), ""],
    ["messages <= 1000", c.welcomeMessage.length <= 1000 && c.congratulationsMessage.length <= 1000, ""]
  ];

  console.log("\n=== RULE CHECKS ===");
  let pass = 0;
  for (const [name, ok, info] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  (" + info + ")" : ""}`);
    if (ok) pass++;
  }
  console.log(`\n${pass}/${checks.length} checks passed.`);
  process.exit(pass === checks.length ? 0 : 1);
})().catch((e) => { console.error("ERROR:", e); process.exit(2); });
