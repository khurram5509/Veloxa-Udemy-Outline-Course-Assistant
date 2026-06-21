/* URL helpers shared by background (importScripts) and popup (<script>). Kept tiny + tested. */
(function (root) {
  function isManageUrl(u) {
    u = u || "";
    return /:\/\/[^/]*udemy\.com\//i.test(u) && /\/manage(\/|$)/i.test(u);
  }
  // Everything up to and including ".../manage" — robust to any path prefix Udemy uses.
  function deriveCourseBase(u) {
    if (!isManageUrl(u)) return null;
    const i = (u || "").indexOf("/manage");
    return i < 0 ? null : u.slice(0, i + "/manage".length);
  }
  // which of the 3 fillable pages a URL is on (or null)
  function pageFromUrl(u) {
    u = u || "";
    if (/\/manage\/goals/i.test(u)) return { key: "goals", label: "Intended learners" };
    if (/\/manage\/basics/i.test(u)) return { key: "basics", label: "Course landing page" };
    if (/\/manage\/communications\/messages/i.test(u)) return { key: "messages", label: "Course messages" };
    if (/\/manage\/curriculum/i.test(u)) return { key: "curriculum", label: "Curriculum" };
    return null;
  }
  root.UrlUtils = { isManageUrl, deriveCourseBase, pageFromUrl };
})(typeof self !== "undefined" ? self : this);
