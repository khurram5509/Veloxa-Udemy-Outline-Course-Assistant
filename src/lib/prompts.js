/* Prompt templates + small text helpers shared by the generator. */
(function (root) {
  const AI_PREFIX = "This course contains the use of artificial intelligence.";

  function wordCount(s) { return (s || "").trim().split(/\s+/).filter(Boolean).length; }
  function norm(s) { return (s || "").replace(/\s+/g, " ").trim(); }

  function mainSystem() {
    return [
      "You are an expert Udemy course marketing copywriter and curriculum strategist.",
      "You turn an instructor's raw course outline/notes into polished, conversion-focused course metadata.",
      "You write in clear, benefit-driven English. You never invent facts that contradict the source document,",
      "but you may improve wording, fix grammar, and fill small gaps to make the content complete and compelling.",
      "You ALWAYS reply with a single valid JSON object and nothing else."
    ].join(" ");
  }

  function mainPrompt(o) {
    const { docText, profile, categories, levels, taxonomy } = o;
    const profName = (profile && profile.name) || "the instructor";
    const fromName = (profile && profile.fromName) || profName;

    return `Using the COURSE DOCUMENT below, produce Udemy course metadata as a JSON object.

PROFILE (use in the messages):
- Profile / instructor name: "${profName}"
- Messages are sent "from": "${fromName}"

Return JSON with EXACTLY these keys:
{
  "title": string,            // <= 60 characters, attention-grabbing + searchable
  "subtitle": string,         // <= 120 characters, 1-2 keywords + 3-4 key areas covered
  "description": string,      // 250-350 words, PLAIN TEXT only (no URLs/links, no module or lecture counts). MUST start with this exact sentence: "${AI_PREFIX}"
  "level": string,            // one of: ${levels.join(" | ")}
  "category": string,         // one of the categories listed below
  "subcategory": string,      // one of the sub-categories that belongs to the chosen category
  "primarilyTaught": string,  // short phrase, e.g. "Landscape Photography"
  "objectives": string[],     // 6-8 items, what students will learn; each <= 160 chars; action verbs
  "requirements": string[],   // 1-4 items, prerequisites; if none, reassure beginners
  "audience": string[],       // 1-4 items, who this course is for
  "welcomeMessage": string,   // friendly welcome; MUST mention the course name, the profile name "${profName}", and that it is from "${fromName}"
  "congratulationsMessage": string, // congrats on completion; MUST mention the course name, the profile name "${profName}", and that it is from "${fromName}"
  "curriculum": [ { "title": string, "lectures": string[] } ] // ONE section per module/part in the document (include ALL of them); each section's lectures are its lessons/topics (no duplicates, <= 80 chars each)
}

CATEGORY OPTIONS (pick category + a matching subcategory from the same line):
${Object.entries(taxonomy).map(([c, s]) => `- ${c}: ${s.join(", ")}`).join("\n")}

RULES:
- description MUST begin literally with: "${AI_PREFIX}" and then continue naturally.
- description must be between 250 and 350 words.
- title <= 60 chars, subtitle <= 120 chars, each objective <= 160 chars.
- Choose the single best-fitting category and subcategory.
- Output ONLY the JSON object, no markdown, no commentary.

COURSE DOCUMENT:
"""
${docText}
"""`;
  }

  function extractSystem() {
    return [
      "You are a precise information extractor for Udemy course metadata.",
      "You COPY the author's own wording from the document. You do NOT rewrite, improve, rephrase,",
      "expand, shorten, summarize, or invent content. If a field is not present in the document, leave it empty.",
      "You ALWAYS reply with a single valid JSON object and nothing else."
    ].join(" ");
  }

  function extractPrompt(o) {
    const { docText, profile, levels, taxonomy } = o;
    const profName = (profile && profile.name) || "the instructor";
    const fromName = (profile && profile.fromName) || profName;
    return `Extract Udemy course metadata from the COURSE DOCUMENT below, using the author's EXACT wording.

STRICT RULES — this is extraction, NOT writing:
- Do NOT rewrite, improve, rephrase, expand, shorten, or summarize. Copy text as-is.
- Do NOT invent facts. If a field is not in the document, return "" (or [] for lists).
- The ONLY exception: for category, subcategory and level, choose the closest match from the lists.
- For welcomeMessage / congratulationsMessage: if the document contains them, copy them; otherwise write ONE short plain sentence that mentions the course name and "${profName}" from "${fromName}".

Return JSON with EXACTLY these keys:
{
  "title": string, "subtitle": string, "description": string,
  "level": string, "category": string, "subcategory": string, "primarilyTaught": string,
  "objectives": string[], "requirements": string[], "audience": string[],
  "welcomeMessage": string, "congratulationsMessage": string,
  "curriculum": [ { "title": string, "lectures": string[] } ]
}

For "curriculum": copy the document's modules / sections and their lecture or topic titles VERBATIM. If the document has none, return [].
LEVEL options: ${levels.join(" | ")}
CATEGORY options (pick category + a subcategory from the same line):
${Object.entries(taxonomy).map(([c, s]) => `- ${c}: ${s.join(", ")}`).join("\n")}

Output ONLY the JSON object.

COURSE DOCUMENT:
"""
${docText}
"""`;
  }

  function curriculumPrompt(docText) {
    return `From the COURSE DOCUMENT below, produce the FULL course curriculum.
Include EVERY module / section / part / chapter found in the document — do NOT stop early, summarise, or merge them. Keep them in their original order.
For each section, use its lessons / topics / sub-points as lectures (short titles). If a section lists no lessons, use the section title as a single lecture.

Return ONLY this JSON shape (no commentary):
{ "curriculum": [ { "title": "Module 1: ...", "lectures": ["...", "..."] }, { "title": "Module 2: ...", "lectures": ["..."] } ] }

COURSE DOCUMENT:
"""
${docText}
"""`;
  }

  function shortenPrompt(label, max, text) {
    return `Rewrite this Udemy ${label} to be a maximum of ${max} characters while keeping the key keywords and meaning. Return ONLY the rewritten ${label}, no quotes, no extra text:\n\n${text}`;
  }

  function rewriteDescriptionPrompt(text) {
    return `Rewrite the following Udemy course description so it is between 250 and 350 words, engaging and benefit-driven. It MUST begin with this exact sentence: "${AI_PREFIX}". Use PLAIN TEXT only — no URLs or links, and do NOT mention the number of modules or lectures. Return ONLY the description text, no quotes:\n\n${text}`;
  }

  function expandDescriptionPrompt(current, docText) {
    return `Write a Udemy course description that is BETWEEN 280 AND 340 WORDS — this length is mandatory, count your words.
It MUST begin with this exact sentence: "${AI_PREFIX}"
Make it engaging and benefit-driven. Expand with concrete detail drawn from the source: what students will build, the topics covered, the outcomes and skills gained, who it is for, and why it matters. Use 2-3 short paragraphs of PLAIN TEXT. Do NOT use bullet points, markdown, URLs or links, and do NOT mention the number of modules or lectures. Return ONLY the description text, no quotes.

CURRENT (too short, expand it — do not shorten):
${current}

SOURCE MATERIAL TO DRAW FROM:
"""${(docText || "").slice(0, 6000)}"""`;
  }

  function fixMessagePrompt(kind, profName, fromName, courseTitle, text) {
    return `Rewrite this Udemy ${kind} message. It MUST naturally mention the course name "${courseTitle}", the instructor/profile name "${profName}", and make clear it is from "${fromName}". Keep it warm, concise (under 150 words). Return ONLY the message text:\n\n${text}`;
  }

  function moreObjectivesPrompt(docText, have, need) {
    return `From the course document below, list ${need} additional concise Udemy learning objectives (what students will be able to do), different from these existing ones: ${JSON.stringify(have)}. Each under 160 characters, start with an action verb. Return a JSON array of strings only.\n\nDOCUMENT:\n"""${docText}"""`;
  }

  function trimToWords(text, maxWords) {
    const words = (text || "").trim().split(/\s+/);
    if (words.length <= maxWords) return text;
    // trim by whole sentences so it stays readable
    const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) || [text];
    let out = "";
    for (const s of sentences) {
      if (wordCount(out + s) > maxWords) break;
      out += s;
    }
    if (!out.trim()) out = words.slice(0, maxWords).join(" ") + ".";
    return out.trim();
  }

  root.Prompts = {
    AI_PREFIX, wordCount, norm, trimToWords,
    mainSystem, mainPrompt, extractSystem, extractPrompt, curriculumPrompt,
    shortenPrompt, rewriteDescriptionPrompt, expandDescriptionPrompt, fixMessagePrompt, moreObjectivesPrompt
  };
})(typeof self !== "undefined" ? self : this);
