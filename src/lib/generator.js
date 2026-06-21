/* High-level content generator: calls Ollama, then tests + repairs every field so the
   content respects Udemy's limits and the project's rules before it is filled into the form. */
(function (root) {
  const P = root.Prompts;
  const AI = root.AI;
  const D = root.UdemyData;
  const log = root.Logger;

  // Deterministically read a curriculum from "Module N: …" / "Lecture N.M: …" lines (TOC or body).
  // Dedupes the module/lecture titles (Udemy outlines repeat them in the table of contents).
  function parseCurriculumFromText(text) {
    const lines = (text || "").split(/\r?\n/);
    const secRe = /^(?:module|section|unit|part|chapter|week)\s*\d+\b/i;
    const lecRe = /^(?:lecture|lesson|topic|video|episode)\s*[\d.]*\s*[:\-.)]/i;
    const map = new Map(); const order = []; let curKey = null;
    for (const raw of lines) {
      // strip a trailing table-of-contents page reference (tab / dot-leader / wide-gap + number) FIRST
      const line = raw.replace(/\t.*$/, "").replace(/\.{2,}\s*\d+\s*$/, "").replace(/\s{2,}\d+\s*$/, "").replace(/\s+/g, " ").trim();
      if (!line) continue;
      if (secRe.test(line)) {
        const key = line.toLowerCase();
        if (!map.has(key)) { map.set(key, { title: line.slice(0, 80), lectures: [], seen: new Set() }); order.push(key); }
        curKey = key;
      } else if (lecRe.test(line) && curKey) {
        const sec = map.get(curKey); const lt = line.slice(0, 80); const k = lt.toLowerCase();
        if (!sec.seen.has(k)) { sec.seen.add(k); sec.lectures.push(lt); }
      }
    }
    return order.map((k) => ({ title: map.get(k).title, lectures: map.get(k).lectures })).filter((s) => s.title);
  }

  function safeParse(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) {}
    // try to extract the first {...} block
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
    return null;
  }

  function asArray(v) {
    if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
    if (typeof v === "string") return v.split(/\n|;|•|•/).map((s) => s.replace(/^[-*\d.)\s]+/, "").trim()).filter(Boolean);
    return [];
  }

  function lc(s) { return (s || "").toLowerCase(); }

  // crude similarity for matching category/subcategory to the taxonomy
  function score(a, b) {
    a = lc(a); b = lc(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.85;
    const aw = new Set(a.split(/\W+/).filter(Boolean));
    const bw = b.split(/\W+/).filter(Boolean);
    let hit = 0; for (const w of bw) if (aw.has(w)) hit++;
    return bw.length ? hit / bw.length * 0.8 : 0;
  }
  function bestMatch(value, options) {
    let best = options[0], bestScore = -1;
    for (const o of options) { const s = score(value, o); if (s > bestScore) { bestScore = s; best = o; } }
    return { value: best, score: bestScore };
  }

  function truncateChars(s, max) {
    s = String(s || "").trim();
    if (s.length <= max) return s;
    let cut = s.slice(0, max);
    const sp = cut.lastIndexOf(" ");
    if (sp > max * 0.6) cut = cut.slice(0, sp);
    return cut.trim();
  }

  // Replace placeholder tokens the model sometimes leaves in (e.g. "[Profile Name]", "[Course Name]").
  function subPlaceholders(s, ctx) {
    if (!s) return s;
    const name = ctx.name || "", from = ctx.from || name || "", title = ctx.title || "";
    let t = String(s);
    t = t.replace(/\[\s*(?:the\s+)?(?:profile\s*name|instructor(?:'s)?\s*name|your\s*name|profile|instructor|name)\s*\]/gi, name);
    t = t.replace(/\[\s*(?:the\s+)?course(?:\s*(?:name|title))?\s*\]/gi, title);
    t = t.replace(/\[\s*(?:from(?:\s*name)?|brand|academy|company|school)\s*\]/gi, from);
    t = t.replace(/\{\{?\s*(?:profile_?name|instructor|name)\s*\}?\}/gi, name);
    t = t.replace(/\{\{?\s*course(?:_?name|_?title)?\s*\}?\}/gi, title);
    return t;
  }
  // Strip chat preamble + wrapping quotes from a free-text model reply, then sub placeholders.
  function cleanModelText(s, ctx) {
    if (!s) return s;
    let t = String(s).trim();
    t = t.replace(/^\s*(?:sure[,!.]?\s*)?(?:here(?:'s| is)\b|below is\b|this is\b|the\s+(?:rewritten|revised|updated|new)\b)[^:\n]{0,90}:\s*/i, "");
    t = t.replace(/^["'“”\s]+/, "").replace(/\s*["'“”]+\s*$/, "").trim();
    return subPlaceholders(t, ctx || {}).replace(/[ \t]{2,}/g, " ").trim();
  }

  // strip URLs/links and "N Modules | M Lectures"-style counts from a description (plain text only)
  function cleanDescription(text) {
    let t = String(text || "");
    t = t.replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.|mailto:)[^)]+\)/gi, "$1"); // markdown link -> label
    t = t.replace(/\bhttps?:\/\/\S+/gi, "").replace(/\bwww\.[^\s)]+/gi, "");      // bare URLs
    t = t.replace(/\b\d+\+?\s*modules?\s*[|·•\/\-–—]\s*\d+\+?\s*lectures?\b/gi, ""); // "6 Modules | 25+ Lectures"
    return t.replace(/\s+([.,;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  // expand/rewrite a description until it sits within the word range (reused by built-in + custom prompts)
  async function fitDescription(desc, ctx) {
    const L = D.limits, mc = { name: ctx.name, from: ctx.from, title: ctx.title };
    const inRange = (n) => n >= L.descriptionMinWords && n <= L.descriptionMaxWords;
    const target = Math.round((L.descriptionMinWords + L.descriptionMaxWords) / 2);
    let wc = P.wordCount(desc), tries = 0;
    while (!inRange(wc) && tries < 3) {
      tries++;
      const prompt = wc < L.descriptionMinWords ? P.expandDescriptionPrompt(desc, ctx.doc) : P.rewriteDescriptionPrompt(desc);
      let cand;
      try { cand = ensureAIPrefix(cleanModelText(await AI.generateText(ctx.cfg, ctx.model, prompt, { temperature: ctx.temp }), mc)); }
      catch (e) { break; }
      const cwc = P.wordCount(cand);
      if (inRange(cwc) || Math.abs(target - cwc) < Math.abs(target - wc)) { desc = cand; wc = cwc; }
      if (inRange(wc)) break;
    }
    if (wc > L.descriptionMaxWords) desc = ensureAIPrefix(P.trimToWords(desc, L.descriptionMaxWords));
    return desc;
  }

  function ensureAIPrefix(desc) {
    let d = (desc || "").trim();
    const p = P.AI_PREFIX.toLowerCase();
    // strip a near-duplicate opening if present
    if (d.toLowerCase().startsWith(p)) return P.AI_PREFIX + d.slice(P.AI_PREFIX.length);
    return P.AI_PREFIX + " " + d;
  }

  function includesAll(text, parts) {
    const t = lc(text);
    return parts.filter(Boolean).every((p) => t.includes(lc(p)));
  }

  // mode: "improve" (rewrite/expand for quality) or "extract" (verbatim, no improvement)
  async function run(baseUrl, model, docText, profile, settings, mode) {
    settings = settings || {};
    mode = mode === "extract" ? "extract" : "improve";
    const temp = mode === "extract" ? 0.1 : (settings.temperature != null ? Number(settings.temperature) : 0.4);
    const max = 14000;
    let doc = (docText || "").trim();
    if (doc.length > max) { doc = doc.slice(0, max); await log.warn(`Document truncated to ${max} chars for the model.`); }
    if (doc.length < 30) await log.warn("Document text is very short — content may be generic.");

    const prompt = mode === "extract"
      ? P.extractPrompt({ docText: doc, profile, levels: D.levels, taxonomy: D.taxonomy })
      : P.mainPrompt({ docText: doc, profile, categories: D.categories, levels: D.levels, taxonomy: D.taxonomy });
    const system = mode === "extract" ? P.extractSystem() : P.mainSystem();
    const cfg = AI.cfgFrom(settings, baseUrl); // route to Ollama or OpenAI
    const who = cfg.provider === "openai" ? "ChatGPT" : "Ollama";

    await log.info(`Asking ${who} (${model}) to ${mode === "extract" ? "extract the content verbatim" : "draft the course content"}…`);
    let raw = await AI.generateJSON(cfg, model, prompt, { temperature: temp, system });
    let c = safeParse(raw);
    if (!c) {
      await log.warn("Response was not valid JSON — retrying once at low temperature.");
      raw = await AI.generateJSON(cfg, model, prompt + "\n\nReturn ONLY a valid JSON object.", { temperature: 0.1, system });
      c = safeParse(raw);
    }
    if (!c) throw new Error(`${who} did not return valid JSON. Try a different model in Settings.`);

    await log.info(mode === "extract" ? "Extracted — normalizing fields (no rewriting)…" : "Draft received — analyzing & repairing fields…");
    return await validate(c, { cfg, model, profile, temp, doc, mode, fullDoc: (docText || "").trim(), fillCurriculum: settings.fillCurriculum === true });
  }

  async function validate(c, ctx) {
    const { cfg, model, profile, temp, doc, mode } = ctx;
    const improve = mode !== "extract";
    const L = D.limits;
    const out = {};
    const profName = (profile && profile.name) || "your instructor";
    const fromName = (profile && profile.fromName) || profName;
    const mctx = () => ({ name: profName, from: fromName, title: out.title });

    // per-profile field config: enabled flag + custom prompt (default: enabled, no custom prompt)
    const fcfg = (profile && profile.fields) || {};
    const defPrompt = (k) => { const f = (D.fields || []).find((x) => x.key === k); return (f && f.defaultPrompt) || ""; };
    const en = (k) => !fcfg[k] || fcfg[k].en !== false;            // field enabled for this profile?
    // a custom override only if the prompt was EDITED away from the field's default (else use built-in)
    const cp = (k) => { const p = ((fcfg[k] && fcfg[k].prompt) || "").trim(); return (p && p !== defPrompt(k)) ? p : ""; };
    const def = (k) => improve && en(k) && !cp(k);                // run the DEFAULT improvement?

    // ---- title ----
    out.title = subPlaceholders(P.norm(c.title), { name: profName, from: fromName, title: "" });
    if (out.title.length > L.titleMax) {
      if (def("title")) {
        await log.warn(`Title ${out.title.length} chars > ${L.titleMax}; asking model to shorten.`);
        const s = await AI.generateText(cfg, model, P.shortenPrompt("course title", L.titleMax, out.title), { temperature: 0.3 });
        out.title = cleanModelText(s, mctx()) || out.title;
      } else {
        await log.warn(`Title ${out.title.length} chars > ${L.titleMax}; trimming to fit (no rewrite).`);
      }
      out.title = truncateChars(out.title, L.titleMax);
    }
    await log.info(`✓ Title (${out.title.length}/${L.titleMax})`, out.title);

    // ---- subtitle ----
    out.subtitle = subPlaceholders(P.norm(c.subtitle), mctx());
    if (out.subtitle.length > L.subtitleMax) {
      if (def("subtitle")) {
        await log.warn(`Subtitle ${out.subtitle.length} chars > ${L.subtitleMax}; shortening.`);
        const s = await AI.generateText(cfg, model, P.shortenPrompt("course subtitle", L.subtitleMax, out.subtitle), { temperature: 0.3 });
        out.subtitle = cleanModelText(s, mctx()) || out.subtitle;
      }
      out.subtitle = truncateChars(out.subtitle, L.subtitleMax);
    }
    await log.info(`✓ Subtitle (${out.subtitle.length}/${L.subtitleMax})`);

    // ---- description ---- (plain text; links/counts stripped in the final pass below)
    let desc = ensureAIPrefix(subPlaceholders(c.description, mctx()));
    const inRange = (n) => n >= L.descriptionMinWords && n <= L.descriptionMaxWords;
    if (def("description")) {
      if (!inRange(P.wordCount(desc))) await log.warn(`Description ${P.wordCount(desc)} words; fitting to ${L.descriptionMinWords}-${L.descriptionMaxWords}…`);
      desc = await fitDescription(desc, { cfg, model, temp, doc, name: profName, from: fromName, title: out.title });
    } else if (!inRange(P.wordCount(desc))) {
      await log.warn(`Description is ${P.wordCount(desc)} words — kept verbatim (no improvement mode).`);
    }
    out.description = desc;
    await log.info(`✓ Description (${P.wordCount(desc)} words, AI prefix: ${desc.startsWith(P.AI_PREFIX) ? "yes" : "no"})`);

    // ---- level ----
    const lvl = bestMatch(c.level, D.levels);
    out.level = lvl.value;
    await log.info(`✓ Level → ${out.level}`);

    // ---- category + subcategory ----
    const cat = bestMatch(c.category, D.categories);
    out.category = cat.value;
    const subs = D.taxonomy[out.category] || [];
    const sub = bestMatch(c.subcategory, subs);
    out.subcategory = sub.value;
    await log.info(`✓ Category → ${out.category} / ${out.subcategory}`);

    // ---- primarily taught ----
    out.primarilyTaught = subPlaceholders(P.norm(c.primarilyTaught), mctx()) || out.subcategory;
    await log.info(`✓ Primarily taught → ${out.primarilyTaught}`);

    // ---- objectives ----
    let objectives = asArray(c.objectives).map((s) => truncateChars(subPlaceholders(s, mctx()), L.objectiveMax));
    if (def("objectives") && objectives.length < L.minObjectives) {
      const need = L.minObjectives - objectives.length;
      await log.warn(`Only ${objectives.length} objectives; asking for ${need} more (min ${L.minObjectives}).`);
      try {
        const r = await AI.generateJSON(cfg, model, P.moreObjectivesPrompt(doc, objectives, Math.max(need, 3)), { temperature: temp });
        const extra = asArray(safeParse(r) || r);
        objectives = objectives.concat(extra.map((s) => truncateChars(s, L.objectiveMax)));
      } catch (e) { await log.warn("Could not fetch extra objectives: " + e.message); }
    }
    out.objectives = objectives.slice(0, 12);
    if (out.objectives.length < L.minObjectives) await log.warn(`Still only ${out.objectives.length} objectives — Udemy requires at least ${L.minObjectives}.`);
    await log.info(`✓ Objectives (${out.objectives.length})`);

    out.requirements = asArray(c.requirements).map((s) => subPlaceholders(s, mctx()));
    if (!out.requirements.length) out.requirements = ["No prior experience required — this course starts from the basics."];
    await log.info(`✓ Requirements (${out.requirements.length})`);

    out.audience = asArray(c.audience).map((s) => subPlaceholders(s, mctx()));
    if (!out.audience.length) out.audience = ["Anyone interested in " + (out.primarilyTaught || out.title) + "."];
    await log.info(`✓ Audience (${out.audience.length})`);

    // ---- messages: must mention course name, profile name and "from" name ----
    const tokens = [out.title, profName, fromName];

    out.welcomeMessage = await fixMessage("welcome", c.welcomeMessage, tokens, ctx, profName, fromName, out.title, def("welcomeMessage"));
    out.congratulationsMessage = await fixMessage("congratulations", c.congratulationsMessage, tokens, ctx, profName, fromName, out.title, def("congratulationsMessage"));

    // ---- curriculum (sections + lectures) ----
    const dedupe = (arr) => { const seen = new Set(), out2 = []; for (const x of arr) { const k = x.toLowerCase(); if (x && !seen.has(k)) { seen.add(k); out2.push(x); } } return out2; };
    out.curriculum = Array.isArray(c.curriculum) ? c.curriculum.map((s) => ({
      title: P.norm(subPlaceholders(s && s.title, mctx())).slice(0, 80),
      lectures: dedupe(asArray(s && s.lectures).map((l) => P.norm(subPlaceholders(l, mctx())).slice(0, 80))).slice(0, 20)
    })).filter((s) => s.title).slice(0, 30) : [];
    // every section needs at least one lecture (Udemy requirement)
    out.curriculum.forEach((s, i) => { if (!s.lectures.length) s.lectures = [s.title]; });

    // When curriculum will actually be filled, capture ALL modules (the main JSON truncates the
    // curriculum because it comes last). Use whichever source is richest:
    //   draft (main JSON) · deterministic parse of Module/Lecture headings · dedicated AI extraction.
    if (en("curriculum") && ctx.fillCurriculum) {
      const norm = (arr) => (arr || []).map((s) => ({
        title: P.norm(subPlaceholders(s && s.title, mctx())).slice(0, 80),
        lectures: dedupe(asArray(s && s.lectures).map((l) => P.norm(subPlaceholders(l, mctx())).slice(0, 80))).slice(0, 20)
      })).filter((s) => s.title).slice(0, 40);
      const lcount = (arr) => arr.reduce((a, s) => a + s.lectures.length, 0);
      const candidates = [out.curriculum];
      try { const ft = norm(parseCurriculumFromText(ctx.fullDoc || doc)); if (ft.length) candidates.push(ft); } catch (e) {}
      try {
        const r = safeParse(await AI.generateJSON(cfg, model, P.curriculumPrompt((ctx.fullDoc || doc).slice(0, 20000)), { temperature: 0.1, num_ctx: 12288 }));
        const arr = Array.isArray(r) ? r : (r && Array.isArray(r.curriculum) ? r.curriculum : null);
        if (arr) { const ai = norm(arr); if (ai.length) candidates.push(ai); }
      } catch (e) { await log.warn("Curriculum AI extraction failed: " + e.message); }
      const usable = candidates.filter((c) => c && c.length).sort((a, b) => (lcount(b) - lcount(a)) || (b.length - a.length));
      if (usable.length) out.curriculum = usable[0];
    }
    out.curriculum.forEach((s) => { if (!s.lectures.length) s.lectures = [s.title]; });
    await log.info(`✓ Curriculum (${out.curriculum.length} section(s), ${out.curriculum.reduce((a, s) => a + s.lectures.length, 0)} lecture(s))`);

    // ---- per-profile field config: record enabled flags + apply custom prompts ----
    out._fields = {};
    for (const f of D.fields) {
      out._fields[f.key] = en(f.key);
      if (!en(f.key)) { await log.info(`↷ ${f.label}: disabled for this profile — skipped.`); continue; }
      if (improve && cp(f.key)) {
        try {
          const v = await customField(f, cp(f.key), { cfg, model, temp, doc, profName, fromName }, out);
          if (f.key === "category") { out.category = v.category; out.subcategory = v.subcategory; }
          else out[f.key] = v;
          await log.info(`✦ ${f.label}: applied this profile's custom prompt.`);
        } catch (e) { await log.warn(`Custom prompt for ${f.label} failed (kept default): ${e.message}`); }
      }
    }

    // final description pass: plain text only — strip URLs/links and module/lecture counts,
    // keep the AI prefix, and ensure it never exceeds the word limit.
    if (en("description") && out.description) {
      out.description = ensureAIPrefix(cleanDescription(out.description));
      if (P.wordCount(out.description) > L.descriptionMaxWords) out.description = ensureAIPrefix(P.trimToWords(out.description, L.descriptionMaxWords));
    }

    out._generatedAt = new Date().toISOString();
    return out;
  }

  // generate a single field's value from this profile's custom prompt
  async function customField(f, instruction, ctx, out) {
    const L = D.limits, key = f.key;
    const mc = { name: ctx.profName, from: ctx.fromName, title: out.title };
    const isList = ["objectives", "requirements", "audience"].includes(key);
    const cur = key === "category" ? `${out.category} > ${out.subcategory}` : out[key];
    const fmt = isList ? "Return ONLY a JSON array of short strings."
      : key === "curriculum" ? 'Return ONLY a JSON array of objects like {"title": string, "lectures": string[]}.'
      : key === "level" ? `Return ONLY one of exactly: ${D.levels.join(" | ")}.`
      : key === "category" ? `Return ONLY "<Category> > <Subcategory>" picked from this taxonomy:\n${D.flatCategoryList()}`
      : "Return ONLY the improved text — no preamble, no surrounding quotes, no markdown.";
    const prompt = `Improve the "${f.label}" field of a Udemy course. Follow these instructions EXACTLY:\n${instruction}\n\n${fmt}\n\nCURRENT DRAFT:\n${typeof cur === "string" ? cur : JSON.stringify(cur)}\n\nCOURSE DOCUMENT (context only):\n"""${(ctx.doc || "").slice(0, 6000)}"""`;

    if (isList) {
      const r = safeParse(await AI.generateJSON(ctx.cfg, ctx.model, prompt, { temperature: ctx.temp }));
      let arr = asArray(r).map((s) => P.norm(subPlaceholders(s, mc))).filter(Boolean);
      if (key === "objectives") arr = arr.map((s) => truncateChars(s, L.objectiveMax));
      return arr.length ? arr.slice(0, 12) : out[key];
    }
    if (key === "curriculum") {
      const r = safeParse(await AI.generateJSON(ctx.cfg, ctx.model, prompt, { temperature: ctx.temp }));
      if (Array.isArray(r)) {
        const c2 = r.map((s) => ({ title: P.norm(subPlaceholders(s && s.title, mc)).slice(0, 80), lectures: asArray(s && s.lectures).map((l) => P.norm(subPlaceholders(l, mc)).slice(0, 80)).slice(0, 12) })).filter((s) => s.title);
        c2.forEach((s) => { if (!s.lectures.length) s.lectures = [s.title]; });
        return c2.length ? c2.slice(0, 20) : out.curriculum;
      }
      return out.curriculum;
    }
    const txt = cleanModelText(await AI.generateText(ctx.cfg, ctx.model, prompt, { temperature: ctx.temp }), mc);
    if (!txt) return key === "category" ? { category: out.category, subcategory: out.subcategory } : out[key];
    if (key === "level") return bestMatch(txt, D.levels).value;
    if (key === "category") {
      const parts = txt.split(/>|\||\/|,|–|-/).map((s) => s.trim()).filter(Boolean);
      const cat = bestMatch(parts[0] || txt, D.categories).value;
      const sub = bestMatch(parts[1] || txt, D.taxonomy[cat] || []).value;
      return { category: cat, subcategory: sub };
    }
    if (key === "title") return truncateChars(txt, L.titleMax);
    if (key === "subtitle") return truncateChars(txt, L.subtitleMax);
    if (key === "description") return await fitDescription(ensureAIPrefix(txt), { cfg: ctx.cfg, model: ctx.model, temp: ctx.temp, doc: ctx.doc, name: ctx.profName, from: ctx.fromName, title: out.title });
    if (key === "welcomeMessage" || key === "congratulationsMessage") {
      let m = txt;
      if (!includesAll(m, [out.title, ctx.profName, ctx.fromName])) {
        if (!lc(m).includes(lc(out.title))) m += key === "welcomeMessage" ? ` Thank you for enrolling in “${out.title}”.` : ` Thank you for completing “${out.title}”.`;
        if (!lc(m).includes(lc(ctx.profName)) || !lc(m).includes(lc(ctx.fromName))) m += `\n\n— ${ctx.profName}` + (ctx.fromName && ctx.fromName !== ctx.profName ? `, from ${ctx.fromName}` : "");
      }
      return m.slice(0, L.messageMax);
    }
    return txt;
  }

  async function fixMessage(kind, text, tokens, ctx, profName, fromName, title, allowRewrite) {
    const pctx = { name: profName, from: fromName, title };
    // clean up placeholders / preambles the model may have left in the draft
    let msg = cleanModelText(P.norm(text), pctx);
    if (allowRewrite !== false && ctx.mode !== "extract" && !includesAll(msg, tokens)) {
      await log.warn(`${kind} message missing required mentions — rewriting.`);
      try {
        const r = await AI.generateText(ctx.cfg, ctx.model, P.fixMessagePrompt(kind, profName, fromName, title, msg), { temperature: ctx.temp });
        const cleaned = cleanModelText(r, pctx);
        if (cleaned) msg = cleaned;
      } catch (e) { await log.warn(`Could not rewrite ${kind} message: ` + e.message); }
    }
    // deterministic safety net: APPEND (never prepend a second greeting) to guarantee mentions
    if (!includesAll(msg, tokens)) {
      let tail = "";
      if (!lc(msg).includes(lc(title))) tail += kind === "welcome" ? ` Thank you for enrolling in “${title}”.` : ` Thank you for completing “${title}”.`;
      if (!lc(msg).includes(lc(profName)) || !lc(msg).includes(lc(fromName))) {
        tail += `\n\n— ${profName}` + (fromName && fromName !== profName ? `, from ${fromName}` : "");
      }
      msg = (msg.trim() + tail).trim();
      await log.warn(`${kind} message mentions enforced programmatically.`);
    }
    if (msg.length > D.limits.messageMax) msg = truncateChars(msg, D.limits.messageMax);
    await log.info(`✓ ${kind[0].toUpperCase() + kind.slice(1)} message ready (${msg.length} chars)`);
    return msg;
  }

  root.Generator = { run, _cleanModelText: cleanModelText, _subPlaceholders: subPlaceholders, _parseCurriculum: parseCurriculumFromText, _cleanDescription: cleanDescription };
})(typeof self !== "undefined" ? self : this);
