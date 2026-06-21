/* Update-check constants + semver compare. Loaded in background (importScripts) and tested in node. */
(function (root) {
  const REPO = { owner: "khurram5509", name: "Veloxa-Udemy-Outline-Course-Assistant", branch: "main" };
  const REPO_URL = "https://github.com/" + REPO.owner + "/" + REPO.name;
  const MANIFEST_URL = "https://raw.githubusercontent.com/" + REPO.owner + "/" + REPO.name + "/" + REPO.branch + "/manifest.json";

  // compare dotted versions: >0 if a is newer than b, <0 if older, 0 if equal
  function cmpVersion(a, b) {
    const pa = String(a || "0").split(".").map((n) => parseInt(n, 10) || 0);
    const pb = String(b || "0").split(".").map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  root.VersionInfo = { REPO, REPO_URL, MANIFEST_URL, cmpVersion };
})(typeof self !== "undefined" ? self : this);
