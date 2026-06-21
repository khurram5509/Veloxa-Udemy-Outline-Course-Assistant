/* Content script injected on udemy.com/course/<id>/manage/*.
   Receives FILL_PAGE messages and fills the relevant form, working with React-controlled
   inputs by using the native value setters + input/change events. Selectors are anchored on
   visible label / placeholder text because Udemy's CSS class names are hashed and unstable. */
(function () {
  if (window.__uocaFillerLoaded) return;
  window.__uocaFillerLoaded = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const lc = (s) => norm(s).toLowerCase();

  let OVERWRITE = true; // set per FILL_PAGE message
  let FIELDS = {};      // per-profile enabled map (content._fields); missing key => enabled
  let DEDUPE = false;   // remove duplicate lectures from the curriculum before filling
  const fieldOn = (key) => FIELDS[key] !== false;

  function hasValue(el) {
    if (!el) return false;
    if (el.tagName === "SELECT") return el.selectedIndex > 0 && el.value !== "";
    if (el.getAttribute && el.getAttribute("contenteditable") === "true") return norm(el.textContent) !== "";
    return norm(el.value) !== "";
  }
  // returns true if we should skip writing this element (keep existing content)
  function keep(el) { return !OVERWRITE && hasValue(el); }

  // ---------- React-aware setters ----------
  function rawSet(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
  }
  // Clear any existing value first, then fill — so re-runs replace prefilled content.
  function setNativeValue(el, value) {
    el.focus && el.focus();
    if (norm(el.value) !== "") {              // remove what's there
      el.select && el.select();
      rawSet(el, "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    rawSet(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function setSelectValue(sel, text) {
    const opts = Array.from(sel.options || []);
    const want = lc(text);
    let opt = opts.find((o) => lc(o.textContent) === want)
      || opts.find((o) => lc(o.textContent).includes(want) && o.value)
      || opts.find((o) => want.includes(lc(o.textContent)) && o.value && lc(o.textContent).length > 2);
    if (!opt) return false;
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    if (desc && desc.set) desc.set.call(sel, opt.value); else sel.value = opt.value;
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function clearRich(el) {
    el.focus();
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand("selectAll", false);
      document.execCommand("delete", false);
    } catch (_) {}
    // hard fallback if the editor still holds content
    if (norm(el.textContent) !== "") {
      el.innerHTML = "";
      try { el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" })); }
      catch (_) { el.dispatchEvent(new Event("input", { bubbles: true })); }
    }
  }

  function fillRichText(el, text) {
    clearRich(el); // always remove existing content before filling
    el.focus();
    try {
      const parts = String(text).split(/\n{2,}/);
      parts.forEach((p, i) => {
        if (i > 0) document.execCommand("insertParagraph", false);
        document.execCommand("insertText", false, p.replace(/\n/g, " "));
      });
      if (norm(el.textContent) === "") throw new Error("execCommand insert produced nothing");
    } catch (e) {
      el.textContent = String(text);
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  // ---------- ordered DOM walk for label-anchored lookups ----------
  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return (r.width > 0 || r.height > 0);
  }

  function orderedControls() {
    const sel = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),textarea,select,[contenteditable="true"]';
    return Array.from(document.querySelectorAll(sel)).filter(isVisible);
  }

  // find heading/label element whose text matches predicate
  function findLabel(matchers) {
    const els = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,label,legend,strong,p,span,div"));
    for (const el of els) {
      // only consider short-ish text nodes (labels/headings), avoid huge containers
      const t = lc(el.textContent);
      if (!t || t.length > 140) continue;
      if (matchers.some((m) => t.includes(m))) return el;
    }
    return null;
  }

  // get controls that appear in DOM order after a label, before the next known label
  function controlsForSection(labelMatchers, allLabelMatchers) {
    const label = findLabel(labelMatchers);
    if (!label) return [];
    const controls = orderedControls();
    // position helpers
    const after = (a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const otherLabels = (allLabelMatchers || [])
      .filter((g) => g !== labelMatchers)
      .map((g) => findLabel(g))
      .filter(Boolean)
      .filter((l) => after(label, l)); // labels that come after ours
    const nextLabel = otherLabels.sort((a, b) => (after(a, b) ? -1 : 1))[0] || null;
    return controls.filter((c) => after(label, c) && (!nextLabel || after(c, nextLabel)));
  }

  function clickButtonByText(matchers, scope) {
    const root = scope || document;
    const btns = Array.from(root.querySelectorAll('button,a[role="button"],[role="button"]')).filter(isVisible);
    const b = btns.find((x) => matchers.some((m) => lc(x.textContent).includes(m)));
    if (b) { b.click(); return true; }
    return false;
  }

  function findRichEditor(scope) {
    return (scope || document).querySelector('[contenteditable="true"]')
      || (scope || document).querySelector("textarea");
  }

  // poll until fn() returns truthy or timeout; resolves to the value or null
  function waitFor(fn, timeout, interval) {
    timeout = timeout || 12000; interval = interval || 300;
    return new Promise((resolve) => {
      const start = Date.now();
      (function tick() {
        let v = null; try { v = fn(); } catch (_) {}
        if (v) return resolve(v);
        if (Date.now() - start >= timeout) return resolve(null);
        setTimeout(tick, interval);
      })();
    });
  }

  const after = (a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  // the "Add more to your response" button that belongs to a given section
  function addMoreButtonFor(matchers, allMatchers) {
    const label = findLabel(matchers); if (!label) return null;
    const others = (allMatchers || []).filter((g) => g !== matchers)
      .map((g) => findLabel(g)).filter(Boolean).filter((l) => after(label, l));
    const nextLabel = others.sort((a, b) => (after(a, b) ? -1 : 1))[0] || null;
    const btns = Array.from(document.querySelectorAll('button,a[role="button"],[role="button"]'))
      .filter(isVisible).filter((b) => lc(b.textContent).includes("add more"));
    return btns.find((b) => after(label, b) && (!nextLabel || after(b, nextLabel))) || null;
  }

  // ---------- page fillers ----------
  async function fillGoals(content) {
    const filled = [], warnings = [], missing = [];
    const groups = {
      objectives: ["what will students learn"],
      requirements: ["requirements or prerequisites", "what are the requirements"],
      audience: ["who is this course for"]
    };
    const all = Object.values(groups);

    // wait until the page has actually rendered the goals form
    const anchor = await waitFor(() => findLabel(groups.objectives), 12000);
    if (!anchor) return { filled, warnings, missing: ["page did not render the Intended-learners form"], notReady: true };

    // resolve each section's heading ONCE (findLabel scans the whole DOM — don't repeat it in loops)
    const labels = all.map((g) => findLabel(g));
    function inputsForIdx(idx) {
      const label = labels[idx]; if (!label) return [];
      const laters = labels.filter((l, j) => l && j !== idx && after(label, l));
      const next = laters.sort((a, b) => (after(a, b) ? -1 : 1))[0] || null;
      return Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),textarea'))
        .filter(isVisible).filter((x) => after(label, x) && (!next || after(x, next)));
    }
    function addMoreForIdx(idx) {
      const label = labels[idx]; if (!label) return null;
      const laters = labels.filter((l, j) => l && j !== idx && after(label, l));
      const next = laters.sort((a, b) => (after(a, b) ? -1 : 1))[0] || null;
      return Array.from(document.querySelectorAll('button,a[role="button"],[role="button"]'))
        .filter(isVisible).filter((b) => lc(b.textContent).includes("add more"))
        .find((b) => after(label, b) && (!next || after(b, next))) || null;
    }

    async function fillList(idx, name, values) {
      if (!labels[idx]) { missing.push(name); return 0; }
      // Udemy's "Add more to your response" only inserts a new row once the current row has
      // content — so we must INTERLEAVE: fill a row, then add the next, fill it, and so on.
      let n = 0, skipped = 0, couldNotAdd = false;
      for (let i = 0; i < values.length; i++) {
        let controls = inputsForIdx(idx);
        if (i >= controls.length) {
          const btn = addMoreForIdx(idx);
          if (btn) {
            btn.click();
            await waitFor(() => inputsForIdx(idx).length > controls.length, 3000, 150);
            controls = inputsForIdx(idx);
          }
        }
        if (i >= controls.length) { couldNotAdd = true; break; }
        const el = controls[i];
        if (keep(el)) { skipped++; continue; }
        setNativeValue(el, values[i]); n++;
        await sleep(200); // let React commit so the next "Add more" is enabled
      }
      if (skipped) warnings.push(`kept ${skipped} existing row(s) for "${name}" (overwrite off)`);
      if (couldNotAdd || (n + skipped) < values.length) warnings.push(`only ${n}/${values.length} rows filled for "${name}"`);
      return n;
    }

    if (fieldOn("objectives")) { const o = await fillList(0, "what will students learn", content.objectives || []); if (o) filled.push(`objectives:${o}`); else missing.push("learning objectives"); }
    else warnings.push("learning objectives skipped (disabled for this profile)");
    if (fieldOn("requirements")) { const r = await fillList(1, "requirements", content.requirements || []); if (r) filled.push(`requirements:${r}`); else missing.push("requirements"); }
    else warnings.push("requirements skipped (disabled for this profile)");
    if (fieldOn("audience")) { const a = await fillList(2, "who is this course for", content.audience || []); if (a) filled.push(`audience:${a}`); else missing.push("who this is for"); }
    else warnings.push("who this is for skipped (disabled for this profile)");
    return { filled, warnings, missing };
  }

  async function fillBasics(content) {
    const filled = [], warnings = [], missing = [];
    const labelGroups = [
      ["course title"], ["course subtitle"], ["course description"],
      ["what is primarily taught"]
    ];

    function firstControlAfter(matchers, kind) {
      const cs = controlsForSection(matchers, labelGroups);
      for (const c of cs) {
        if (kind === "input" && (c.tagName === "INPUT")) return c;
        if (kind === "rich" && (c.getAttribute("contenteditable") === "true" || c.tagName === "TEXTAREA")) return c;
      }
      return cs[0] || null;
    }

    // the landing page is the heaviest — wait for the title field AND the dropdowns to render
    const anchor = await waitFor(() => firstControlAfter(["course title"], "input"), 15000);
    if (!anchor) return { filled, warnings, missing: ["page did not render the Course-landing-page form"], notReady: true };
    await waitFor(() => Array.from(document.querySelectorAll("select")).filter(isVisible).length >= 2, 6000);

    const put = (el, val, name) => {
      if (!fieldOn(name)) { warnings.push(`${name} skipped (disabled for this profile)`); return; }
      if (!el) { warnings.push(`${name} field not found`); missing.push(name); return; }
      if (keep(el)) { warnings.push(`kept existing ${name} (overwrite off)`); return; }
      setNativeValue(el, val); filled.push(name);
    };

    put(firstControlAfter(["course title"], "input"), content.title, "title");
    put(firstControlAfter(["course subtitle"], "input"), content.subtitle, "subtitle");

    if (!fieldOn("description")) warnings.push("description skipped (disabled for this profile)");
    else {
      const desc = firstControlAfter(["course description"], "rich");
      if (!desc) { warnings.push("description field not found"); missing.push("description"); }
      else if (keep(desc)) warnings.push("kept existing description (overwrite off)");
      else { fillRichText(desc, content.description); filled.push("description"); }
    }

    put(firstControlAfter(["what is primarily taught"], "input"), content.primarilyTaught, "primarilyTaught");

    // selects: identify by their placeholder option text
    const selects = Array.from(document.querySelectorAll("select")).filter(isVisible);
    const levelSel = selects.find((s) => lc(s.options[0] && s.options[0].textContent).includes("level"));
    const catSel = selects.find((s) => { const t = lc(s.options[0] && s.options[0].textContent); return t.includes("category") && !t.includes("sub"); });

    if (!fieldOn("level")) warnings.push("level skipped (disabled for this profile)");
    else if (!levelSel) warnings.push("level select not found");
    else if (keep(levelSel)) warnings.push("kept existing level (overwrite off)");
    else { setSelectValue(levelSel, content.level) ? filled.push("level") : warnings.push("level option not matched"); }

    if (!fieldOn("category")) {
      warnings.push("category skipped (disabled for this profile)");
    } else if (catSel && keep(catSel)) {
      warnings.push("kept existing category/subcategory (overwrite off)");
    } else if (catSel) {
      if (setSelectValue(catSel, content.category)) {
        filled.push("category");
        // subcategory often loads after category is chosen
        let subSel = null;
        for (let i = 0; i < 12; i++) {
          await sleep(300);
          const ss = Array.from(document.querySelectorAll("select")).filter(isVisible);
          subSel = ss.find((s) => lc(s.options[0] && s.options[0].textContent).includes("sub"));
          if (subSel && subSel.options.length > 1) break;
        }
        if (subSel) { setSelectValue(subSel, content.subcategory) ? filled.push("subcategory") : warnings.push("subcategory option not matched"); }
        else warnings.push("subcategory select not found");
      } else warnings.push("category option not matched");
    } else { warnings.push("category select not found"); missing.push("category"); }

    return { filled, warnings, missing };
  }

  async function fillMessages(content) {
    const filled = [], warnings = [], missing = [];
    const labelGroups = [["welcome message"], ["congratulations message"]];

    function editorFor(matchers) {
      const cs = controlsForSection(matchers, labelGroups);
      return cs.find((c) => c.getAttribute && c.getAttribute("contenteditable") === "true")
        || cs.find((c) => c.tagName === "TEXTAREA")
        || null;
    }

    const anchor = await waitFor(() => editorFor(["welcome message"]), 12000);
    if (!anchor) return { filled, warnings, missing: ["page did not render the Course-messages editors"], notReady: true };

    if (!fieldOn("welcomeMessage")) warnings.push("welcome message skipped (disabled for this profile)");
    else {
      const welcome = editorFor(["welcome message"]);
      if (!welcome) { warnings.push("welcome editor not found"); missing.push("welcome message"); }
      else if (keep(welcome)) warnings.push("kept existing welcome message (overwrite off)");
      else { fillRichText(welcome, content.welcomeMessage); filled.push("welcomeMessage"); }
    }
    await sleep(150);
    if (!fieldOn("congratulationsMessage")) warnings.push("congratulations message skipped (disabled for this profile)");
    else {
      const congrats = editorFor(["congratulations message"]);
      if (!congrats) { warnings.push("congratulations editor not found"); missing.push("congratulations message"); }
      else if (keep(congrats)) warnings.push("kept existing congratulations message (overwrite off)");
      else { fillRichText(congrats, content.congratulationsMessage); filled.push("congratulationsMessage"); }
    }

    return { filled, warnings, missing };
  }

  // ---------- curriculum (sections + lectures) ----------
  async function fillCurriculum(content) {
    const filled = [], warnings = [], missing = [];
    if (!fieldOn("curriculum")) return { filled, warnings: ["curriculum skipped (disabled for this profile)"], missing: [] };
    const curriculum = (Array.isArray(content.curriculum) ? content.curriculum : [])
      .map((s) => ({ title: norm(s && s.title).slice(0, 80), lectures: ((s && s.lectures) || []).map((l) => norm(l).slice(0, 80)).filter(Boolean) }))
      .filter((s) => s.title);
    if (!curriculum.length) return { filled, warnings: ["no curriculum data in content"], missing: ["curriculum"] };

    const ready = await waitFor(() => document.querySelector('[data-purpose="section-edit-btn"]'), 15000);
    if (!ready) return { filled, warnings, missing: ["curriculum editor did not render"], notReady: true };

    const q = (sel) => document.querySelector(sel);
    const qa = (sel) => Array.from(document.querySelectorAll(sel)).filter(isVisible);
    function submit(dp, textRe) {
      const b = qa("button").find((x) => x.getAttribute("data-purpose") === dp && !x.disabled)
        || qa("button").find((x) => textRe.test(lc(x.textContent)) && !x.disabled);
      if (b) { b.click(); return true; } return false;
    }
    const visible = (sel) => qa(sel)[0]; // first VISIBLE match (avoids hidden per-section duplicates)
    async function renameFirstSection(title) {
      const e = q('[data-purpose="section-edit-btn"]'); if (!e) return false;
      e.click();
      const inp = await waitFor(() => visible('[data-purpose="section-title"]'), 6000); if (!inp) return false;
      setNativeValue(inp, title); await sleep(250);
      submit("submit-section-form", /save section|add section/); await sleep(900); return true;
    }
    async function renameFirstLecture(title) {
      const e = q('[data-purpose="lecture-edit-btn"]'); if (!e) return false;
      e.click();
      const inp = await waitFor(() => visible('[data-purpose="lecture-title"]'), 6000); if (!inp) return false;
      setNativeValue(inp, title); await sleep(250);
      submit("submit-lecture-form", /save lecture|add lecture/); await sleep(900); return true;
    }
    async function addSection(title) {
      const trigs = qa('[data-purpose="add-item-inline-last"]');
      const btn = trigs[trigs.length - 1] || qa("button").find((b) => lc(b.textContent) === "section");
      if (!btn) return false;
      btn.click();
      const inp = await waitFor(() => { const all = qa('[data-purpose="section-title"]'); return all[all.length - 1]; }, 6000); if (!inp) return false;
      setNativeValue(inp, title); await sleep(250);
      submit("submit-section-form", /add section|save section/); await sleep(1100); return true;
    }
    async function addLectureToSection(sectionIdx, title) {
      // each section has its own "+ Curriculum item" button (one per section, in order).
      // wait for it — after a section first publishes, the editor re-renders briefly.
      const trig = await waitFor(() => {
        const trigs = qa('[data-purpose="add-curriculum-item-dropdown-trigger"]');
        return trigs[sectionIdx] || (trigs.length ? trigs[trigs.length - 1] : null);
      }, 6000);
      if (!trig) return false;
      trig.click();
      // pick the VISIBLE option/input from the dropdown/form that just opened (not a hidden duplicate)
      const lecOpt = await waitFor(() => visible('[data-purpose="add-curriculum-item-lecture"]'), 4000); if (!lecOpt) return false;
      lecOpt.click();
      const inp = await waitFor(() => visible('[data-purpose="lecture-title"]'), 6000); if (!inp) return false;
      setNativeValue(inp, title); await sleep(250);
      submit("submit-lecture-form", /add lecture|save lecture/); await sleep(1000); return true;
    }

    // Read the current sections + their lecture titles (cleaned of "Section N:" / "Lecture N:" prefixes).
    // Used to make filling IDEMPOTENT — re-running never duplicates existing sections/lectures.
    function readStruct() {
      const titles = Array.from(document.querySelectorAll('[data-purpose="item-full-title"]'));
      const secs = []; let cur = null;
      for (const t of titles) {
        const raw = norm(t.textContent);
        const wrap = t.closest && t.closest(".js-curriculum-item-draggable");
        const isSec = /^(section\s|unpublished section)/i.test(raw) || !!(wrap && wrap.querySelector('[data-purpose="section-edit-btn"]'));
        const clean = raw.replace(/^section\s*\d*\s*:?\s*/i, "").replace(/^unpublished section\s*:?\s*/i, "")
          .replace(/^lecture\s*\d*\s*:?\s*/i, "").trim();
        if (isSec) { cur = { title: clean, lectures: [] }; secs.push(cur); }
        else if (cur) cur.lectures.push(clean);
      }
      return secs;
    }

    // optional cleanup: remove duplicate lectures (same title within a section) left by older runs
    async function removeOneDuplicate() {
      const drags = qa(".js-curriculum-item-draggable");
      let seen = new Set();
      for (const d of drags) {
        if (d.querySelector('[data-purpose="section-edit-btn"]')) { seen = new Set(); continue; }
        if (!d.querySelector('[data-purpose="lecture-edit-btn"]')) continue;
        const t = d.querySelector('[data-purpose="item-full-title"]');
        const title = lc(norm(t && t.textContent).replace(/^lecture\s*\d*\s*:?\s*/i, ""));
        if (seen.has(title)) {
          const del = d.querySelector('[data-purpose="lecture-delete-btn"]');
          if (del) {
            del.click();
            const ok = await waitFor(() => qa('[data-purpose="submit-confirm-modal"]')[0], 4000);
            if (ok) { ok.click(); await sleep(1200); return true; }
          }
        }
        seen.add(title);
      }
      return false;
    }
    if (DEDUPE) {
      let removed = 0;
      while (removed < 200 && (await removeOneDuplicate())) removed++;
      if (removed) warnings.push(`removed ${removed} duplicate lecture(s)`);
    }

    let secDone = 0, lecDone = 0;
    for (let i = 0; i < curriculum.length; i++) {
      const target = curriculum[i];
      let struct = readStruct();
      // ensure the section exists (create only if missing — never a duplicate)
      if (i >= struct.length) {
        if (!(await addSection(target.title))) { warnings.push(`could not add section "${target.title}"`); continue; }
      } else if (i === 0 && lc(struct[0].title) !== lc(target.title)) {
        await renameFirstSection(target.title); // rename the default first section
      }
      secDone++;
      // ensure each target lecture exists; SKIP any already present (idempotent → no duplicates)
      const have = new Set((readStruct()[i] || { lectures: [] }).lectures.map((x) => lc(x)));
      for (let j = 0; j < target.lectures.length; j++) {
        const lt = target.lectures[j];
        if (have.has(lc(lt))) { lecDone++; continue; }
        const sec = readStruct()[i] || { lectures: [] };
        const placeholder = sec.lectures.length === 1 && /^introduction$/i.test(sec.lectures[0]) && !target.lectures.some((x) => lc(x) === "introduction");
        const ok = (i === 0 && j === 0 && placeholder) ? await renameFirstLecture(lt) : await addLectureToSection(i, lt);
        if (ok) { lecDone++; have.add(lc(lt)); }
      }
    }
    if (secDone) filled.push(`sections:${secDone}`);
    if (lecDone) filled.push(`lectures:${lecDone}`);
    return { filled, warnings, missing };
  }

  async function clickSave() {
    // click all visible, enabled Save buttons (some pages have one per section)
    await sleep(400);
    const btns = Array.from(document.querySelectorAll("button")).filter(isVisible).filter((b) => !b.disabled);
    let clicked = 0;
    for (const b of btns) {
      const t = lc(b.textContent);
      if (t === "save" || t === "save changes" || t.startsWith("save")) { b.click(); clicked++; await sleep(300); }
    }
    return clicked;
  }

  // ---------- message handling ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "PING") { sendResponse({ ok: true, page: location.pathname }); return true; }
    if (msg.type === "FILL_PAGE") {
      (async () => {
        try {
          OVERWRITE = msg.overwrite !== false; // default to overwriting
          FIELDS = (msg.content && msg.content._fields) || {};
          DEDUPE = msg.dedupe === true;
          let res = { filled: [], warnings: [], missing: [] };
          if (msg.page === "goals") res = await fillGoals(msg.content);
          else if (msg.page === "basics") res = await fillBasics(msg.content);
          else if (msg.page === "messages") res = await fillMessages(msg.content);
          else if (msg.page === "curriculum") res = await fillCurriculum(msg.content);
          else { sendResponse({ ok: false, error: "unknown page " + msg.page }); return; }

          const filled = res.filled || [];
          let saved = 0;
          // curriculum auto-saves each item on submit; other pages use the Save button
          if (msg.page !== "curriculum" && msg.autoSave && filled.length > 0) saved = await clickSave();
          sendResponse({
            ok: true,
            filled,
            warnings: res.warnings || [],
            missing: res.missing || [],
            notReady: !!res.notReady,
            saved: saved > 0,
            saveClicks: saved
          });
        } catch (e) {
          sendResponse({ ok: false, error: String(e && e.message || e) });
        }
      })();
      return true; // async
    }
  });
})();
