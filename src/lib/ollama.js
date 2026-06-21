/* Thin Ollama HTTP client. Used from the background service worker (which has host_permissions
   for localhost:11434, so requests are not blocked by the browser's CORS). */
(function (root) {
  function clean(base) { return (base || "http://localhost:11434").replace(/\/+$/, ""); }

  async function testConnection(baseUrl) {
    const url = clean(baseUrl) + "/api/tags";
    try {
      const r = await fetch(url);
      if (r.status === 403) return { ok: false, reason: "cors" };
      if (!r.ok) return { ok: false, reason: "http", status: r.status };
      const j = await r.json();
      return { ok: true, models: (j.models || []).map((m) => m.name) };
    } catch (e) {
      return { ok: false, reason: "offline", error: String(e && e.message || e) };
    }
  }

  async function listModels(baseUrl) {
    const res = await testConnection(baseUrl);
    if (!res.ok) throw new Error(res.reason === "cors"
      ? "Ollama blocked the request (set OLLAMA_ORIGINS to allow the extension)."
      : res.reason === "offline"
        ? "Could not reach Ollama. Is it running?"
        : "Ollama returned HTTP " + res.status);
    return res.models;
  }

  async function generate(baseUrl, model, prompt, opts) {
    opts = opts || {};
    const body = {
      model,
      prompt,
      stream: false,
      // num_ctx: bigger context so long documents + full JSON output aren't truncated
      // (Ollama's default is often only 2048 tokens, which cuts off later fields like curriculum)
      options: { temperature: opts.temperature != null ? opts.temperature : 0.4, num_ctx: opts.num_ctx || 8192 }
    };
    if (opts.json) body.format = "json";
    if (opts.system) body.system = opts.system;
    const r = await fetch(clean(baseUrl) + "/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (r.status === 403) {
      throw new Error("Ollama returned 403 (blocked origin). Fully reload the extension at chrome://extensions; if it persists, start Ollama with OLLAMA_ORIGINS=* and restart it.");
    }
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error("Ollama HTTP " + r.status + (txt ? ": " + txt.slice(0, 200) : ""));
    }
    const j = await r.json();
    return j.response || "";
  }

  root.Ollama = {
    testConnection,
    listModels,
    generateJSON: (b, m, p, o) => generate(b, m, p, Object.assign({ json: true, temperature: 0.35 }, o || {})),
    generateText: (b, m, p, o) => generate(b, m, p, Object.assign({ temperature: 0.5 }, o || {}))
  };
})(typeof self !== "undefined" ? self : this);
