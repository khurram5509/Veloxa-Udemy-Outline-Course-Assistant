/* Direct (no-AI) content extractor. Parses a structured course outline into the same
   content shape the AI produces, using only deterministic heading/bullet heuristics.
   Quality depends on the document having recognizable section headings. */
(function (root) {
  const AI_PREFIX = "This course contains the use of artificial intelligence.";
  const D = root.UdemyData || {
    levels: ["Beginner Level", "Intermediate Level", "Expert Level", "All Levels"],
    taxonomy: {}, categories: [], limits: { titleMax: 60, subtitleMax: 120, objectiveMax: 160 }
  };

  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const lc = (s) => norm(s).toLowerCase();
  const lines = (t) => (t || "").replace(/\r/g, "").split("\n");

  function truncate(s, max) {
    s = norm(s); if (s.length <= max) return s;
    let c = s.slice(0, max); const sp = c.lastIndexOf(" ");
    if (sp > max * 0.6) c = c.slice(0, sp);
    return c.trim();
  }

  function detectHeading(line) {
    let m = line.match(/^\s*#{1,6}\s+(.+?)\s*$/); if (m) return m[1].trim();         // markdown "# Heading"
    m = line.match(/^\s*([A-Za-z][A-Za-z0-9 &/'’-]{2,48})\s*:\s*$/); if (m) return m[1].trim(); // "Prerequisites:"
    return null;
  }

  function parseSections(text) {
    const out = []; let cur = { h: "(intro)", b: [] };
    for (const raw of lines(text)) {
      const h = detectHeading(raw);
      if (h !== null) { out.push(cur); cur = { h, b: [] }; }
      else cur.b.push(raw);
    }
    out.push(cur);
    return out;
  }

  const sectionMatching = (sections, kws) => sections.find((s) => { const t = lc(s.h); return kws.some((k) => t.includes(k)); });

  function bulletItems(body) {
    return body.map((l) => l.trim()).filter(Boolean)
      .map((l) => l.replace(/^[-*•‣◦]\s*/, "").replace(/^\d+[.)]\s*/, "").trim())
      .filter(Boolean);
  }
  const paragraph = (body) => norm(body.join(" "));

  function score(a, b) {
    a = lc(a); b = lc(b); if (!a || !b) return 0; if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.8;
    const aw = new Set(a.split(/\W+/).filter(Boolean));
    const bw = b.split(/\W+/).filter(Boolean);
    let h = 0; for (const w of bw) if (aw.has(w)) h++;
    return bw.length ? (h / bw.length) * 0.7 : 0;
  }
  function bestCategory(text) {
    let cat = null, sub = null, bs = -1;
    for (const [c, subs] of Object.entries(D.taxonomy || {})) {
      for (const s of subs) { const sc = score(text, s) + 0.3 * score(text, c); if (sc > bs) { bs = sc; cat = c; sub = s; } }
    }
    return { category: cat, subcategory: sub, score: bs };
  }

  function fieldFlags(profile) {
    const cfg = (profile && profile.fields) || {};
    const out = {};
    (D.fields || []).forEach((f) => { out[f.key] = !cfg[f.key] || cfg[f.key].en !== false; });
    return out;
  }

  function fromDocument(docText, profile) {
    profile = profile || {};
    const name = profile.name || "your instructor";
    const from = profile.fromName || name;
    const sections = parseSections(docText);
    const L = D.limits || {};

    // title
    let title = "";
    const titleSec = sectionMatching(sections, ["course title"]);
    if (titleSec) title = paragraph(titleSec.b);
    if (!title) { const first = sections.find((s) => s.h && s.h !== "(intro)"); if (first) title = first.h; }
    title = truncate(title.replace(/^course\s*[:\-]\s*/i, "").trim(), L.titleMax || 60);

    // description (overview)
    const descSec = sectionMatching(sections, ["overview", "description", "about", "summary", "introduction"]);
    let description = descSec ? paragraph(descSec.b) : "";
    if (!description) { const intro = sections.find((s) => s.h === "(intro)"); description = intro ? paragraph(intro.b) : ""; }

    // subtitle
    let subtitle = "";
    const subSec = sectionMatching(sections, ["subtitle", "tagline"]);
    if (subSec) subtitle = paragraph(subSec.b);
    if (!subtitle && description) subtitle = (description.split(/(?<=[.!?])\s/)[0] || description);
    subtitle = truncate(subtitle, L.subtitleMax || 120);

    // lists
    const objSec = sectionMatching(sections, ["will learn", "learning objective", "objectives", "outcomes", "what you", "what students"]);
    let objectives = (objSec ? bulletItems(objSec.b) : []).map((o) => truncate(o, L.objectiveMax || 160));
    const reqSec = sectionMatching(sections, ["require", "prerequis"]);
    const requirements = reqSec ? bulletItems(reqSec.b) : [];
    const audSec = sectionMatching(sections, ["who is this", "who is it for", "who should", "target audience", "audience"]);
    const audience = audSec ? bulletItems(audSec.b) : [];

    // level
    const lvlSec = sectionMatching(sections, ["level", "difficulty"]);
    const lvlText = lc((lvlSec ? paragraph(lvlSec.b) : "") + " " + docText);
    let level = "";
    if (/\ball[\s-]?level|beginner to|any level|all skill/.test(lvlText)) level = "All Levels";
    else if (/expert|advanced/.test(lvlText)) level = "Expert Level";
    else if (/intermediate/.test(lvlText)) level = "Intermediate Level";
    else if (/beginner|basic|entry|no experience|from scratch/.test(lvlText)) level = "Beginner Level";

    // primarily taught
    const topSec = sectionMatching(sections, ["primary topic", "primarily", "primary subject", "what is primarily", "topic", "subject"]);
    let primarilyTaught = topSec ? truncate(paragraph(topSec.b), 80) : "";

    // category / subcategory (deterministic keyword match, not AI)
    const cat = bestCategory(docText);
    const category = cat.score > 0.3 ? cat.category : "";
    const subcategory = cat.score > 0.3 ? cat.subcategory : "";
    if (!primarilyTaught) primarilyTaught = subcategory || title;

    // curriculum: a modules/outline section → one section per item (lecture = same title)
    const modSec = sectionMatching(sections, ["modules", "curriculum", "course outline", "outline", "syllabus", "sections", "lessons", "chapters"]);
    const curriculum = (modSec ? bulletItems(modSec.b) : []).map((t) => ({ title: truncate(t, 80), lectures: [truncate(t, 80)] }));

    // description: guarantee the required AI prefix (string op, no AI)
    if (description && !lc(description).startsWith(lc(AI_PREFIX))) description = AI_PREFIX + " " + description;
    if (!description) description = AI_PREFIX;

    // messages (templated; include course name + profile name + "from")
    const welcomeMessage = `Welcome to "${title}"! This course is brought to you by ${from}. I'm ${name}, and I'm excited to help you get the most out of every lesson. Let's dive in!`;
    const congratulationsMessage = `Congratulations on completing "${title}"! You've put in the work and it shows. Thank you for learning with ${from}. Keep going! — ${name}`;

    return {
      title, subtitle, description, level, category, subcategory, primarilyTaught,
      objectives, requirements, audience, welcomeMessage, congratulationsMessage, curriculum,
      _fields: fieldFlags(profile), _profileId: profile.id, _source: "direct-parse", _generatedAt: new Date().toISOString()
    };
  }

  root.Extractor = { fromDocument, parseSections };
})(typeof self !== "undefined" ? self : this);
