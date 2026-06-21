/* Central logger: persists entries to chrome.storage.local('logs') so the popup can show them
   live (it survives popup close), and mirrors to the console. */
(function (root) {
  const KEY = "logs";
  const MAX = 600;

  async function add(level, msg, data) {
    const entry = { ts: new Date().toISOString(), level, msg, data: data == null ? null : data };
    try {
      const cur = (await chrome.storage.local.get(KEY))[KEY] || [];
      cur.push(entry);
      if (cur.length > MAX) cur.splice(0, cur.length - MAX);
      await chrome.storage.local.set({ [KEY]: cur });
    } catch (e) {
      // storage may be unavailable in some contexts; never throw from the logger
    }
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    try { fn("[UOCA]", msg, data != null ? data : ""); } catch (_) {}
    return entry;
  }

  root.Logger = {
    info: (m, d) => add("info", m, d),
    warn: (m, d) => add("warn", m, d),
    error: (m, d) => add("error", m, d),
    success: (m, d) => add("success", m, d),
    async clear() { try { await chrome.storage.local.set({ [KEY]: [] }); } catch (_) {} },
    async all() { try { return (await chrome.storage.local.get(KEY))[KEY] || []; } catch (_) { return []; } }
  };
})(typeof self !== "undefined" ? self : this);
