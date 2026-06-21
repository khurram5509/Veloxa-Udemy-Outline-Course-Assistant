/* Unified AI client: dispatches to local Ollama OR OpenAI (ChatGPT) based on cfg.provider.
   cfg = { provider: "ollama" | "openai", ollamaUrl, openaiApiKey }.
   Keeps the same generateJSON / generateText shape the generator already uses. */
(function (root) {
  const O = root.Ollama;
  const isOpenAI = (cfg) => (cfg && cfg.provider) === "openai";

  // curated fallback list if /v1/models can't be fetched
  const OPENAI_FALLBACK = ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4-turbo", "gpt-3.5-turbo"];

  const oaBase = (cfg) => ((cfg && cfg.openaiBaseUrl) || "https://api.openai.com").replace(/\/+$/, "");

  async function openaiChat(cfg, model, prompt, opts) {
    opts = opts || {};
    const messages = [];
    if (opts.system) messages.push({ role: "system", content: opts.system });
    messages.push({ role: "user", content: prompt });
    const body = { model: model || "gpt-4o-mini", messages, temperature: opts.temperature != null ? opts.temperature : 0.4 };
    if (opts.json) body.response_format = { type: "json_object" };
    const r = await fetch(oaBase(cfg) + "/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + ((cfg && cfg.openaiApiKey) || "") },
      body: JSON.stringify(body)
    });
    if (r.status === 401) throw new Error("OpenAI rejected the API key (401). Check it in Settings.");
    if (r.status === 429) throw new Error("OpenAI rate limit / quota exceeded (429).");
    if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error("OpenAI HTTP " + r.status + (t ? ": " + t.slice(0, 200) : "")); }
    const j = await r.json();
    return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
  }

  async function testConnection(cfg) {
    cfg = cfg || {};
    if (isOpenAI(cfg)) {
      if (!cfg.openaiApiKey) return { ok: false, reason: "nokey" };
      try {
        const r = await fetch(oaBase(cfg) + "/v1/models", { headers: { Authorization: "Bearer " + cfg.openaiApiKey } });
        if (r.status === 401) return { ok: false, reason: "badkey" };
        if (!r.ok) return { ok: false, reason: "http", status: r.status };
        const j = await r.json();
        let models = (j.data || []).map((m) => m.id).filter((id) => /^(gpt-|o\d|chatgpt)/i.test(id) && !/audio|realtime|transcribe|tts|image|embedding|moderation/i.test(id)).sort();
        return { ok: true, models: models.length ? models : OPENAI_FALLBACK };
      } catch (e) { return { ok: false, reason: "offline", error: String(e && e.message || e) }; }
    }
    return O.testConnection(cfg.ollamaUrl);
  }

  async function generateJSON(cfg, model, prompt, opts) {
    opts = Object.assign({ json: true, temperature: 0.35 }, opts || {});
    if (isOpenAI(cfg)) return openaiChat(cfg, model, prompt, opts);
    return O.generateJSON(cfg.ollamaUrl, model, prompt, opts);
  }

  async function generateText(cfg, model, prompt, opts) {
    opts = Object.assign({ temperature: 0.5 }, opts || {});
    if (isOpenAI(cfg)) return openaiChat(cfg, model, prompt, opts);
    return O.generateText(cfg.ollamaUrl, model, prompt, opts);
  }

  // build a client cfg from a settings object (+ optional baseUrl override for Ollama)
  function cfgFrom(settings, ollamaUrl) {
    settings = settings || {};
    return {
      provider: settings.provider === "openai" ? "openai" : "ollama",
      ollamaUrl: ollamaUrl || settings.ollamaUrl || "http://localhost:11434",
      openaiApiKey: settings.openaiApiKey || "",
      openaiBaseUrl: settings.openaiBaseUrl || ""
    };
  }

  root.AI = { testConnection, generateJSON, generateText, cfgFrom };
})(typeof self !== "undefined" ? self : this);
