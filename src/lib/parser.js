/* Document parsing for the popup. Supports .txt/.md, .docx (mammoth) and .pdf (pdf.js).
   Expects mammoth (window.mammoth) and pdfjsLib (window.pdfjsLib) to be loaded already. */
(function (root) {
  function readAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsArrayBuffer(file);
    });
  }
  function readAsText(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsText(file);
    });
  }

  async function parseDocx(file) {
    const arrayBuffer = await readAsArrayBuffer(file);
    const result = await window.mammoth.extractRawText({ arrayBuffer });
    return result.value || "";
  }

  async function parsePdf(file) {
    if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("src/vendor/pdf.worker.min.js");
    }
    const data = await readAsArrayBuffer(file);
    const pdf = await window.pdfjsLib.getDocument({ data }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it) => it.str).join(" ") + "\n";
    }
    return text;
  }

  async function parseFile(file) {
    const name = (file.name || "").toLowerCase();
    if (name.endsWith(".docx")) return parseDocx(file);
    if (name.endsWith(".pdf")) return parsePdf(file);
    if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".markdown") || file.type.startsWith("text/")) return readAsText(file);
    if (name.endsWith(".doc")) throw new Error("Legacy .doc is not supported — please save as .docx, .pdf or .txt.");
    // last resort: try as text
    return readAsText(file);
  }

  root.Parser = { parseFile };
})(typeof window !== "undefined" ? window : this);
