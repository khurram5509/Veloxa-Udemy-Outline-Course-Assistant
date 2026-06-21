# Udemy Outline Course Assistant — v3.0.0 · by Veloxa Labs

> **Repo:** https://github.com/khurram5509/Veloxa-Udemy-Outline-Course-Assistant
>
> **Install:** `git clone` (or download ZIP) → `chrome://extensions` → enable Developer mode →
> **Load unpacked** → select this folder.
>
> **Updating:** the extension checks this repo for new versions and shows an "Update available"
> badge/banner. To update, run `git pull` (or re-download), then click the reload ↻ on the
> extension at `chrome://extensions` (unpacked extensions can't self-install). Toggle the
> auto-check in **Settings → About → Updates**.

A Chrome (Manifest V3) extension that fills a Udemy course's **Intended learners**,
**Course landing page**, and **Course messages** forms automatically from a document file,
using your choice of AI: **local Ollama** (private, free) or **ChatGPT / OpenAI** (API key).

> **AI provider** is chosen in **Settings → AI provider**. With Ollama, nothing leaves your
> machine. With ChatGPT, your document is sent to OpenAI (`api.openai.com`) using an API key
> you paste in Settings (stored only on your device). Everything else — the modes, per-profile
> field prompts, filling — works the same either way.

**Cross-platform:** runs on **macOS, Windows, and Linux** — the extension is pure browser
code; only the Ollama install commands differ (full instructions are on the **Help & Setup**
tab inside the extension's Settings).

---

## What it does

1. Pick a **profile** (and, for AI mode, an **Ollama model**), and upload your course
   document (`.docx`, `.pdf`, `.txt`, `.md`).
2. Choose how to generate the content — all produce the same **editable preview**, which
   is saved so you can tweak it or reopen the popup and reuse it:
   - **Analyze & Improve with Ollama** — Ollama drafts every field, then the extension
     **tests & repairs** it against Udemy's rules (best quality; expands the description to
     250–350 words, fixes lengths, picks category).
   - **Parse with Ollama (no improvement)** — Ollama maps the document into the fields using
     your **exact wording** (no rewriting, expanding, or inventing). Only category/level are
     matched to valid options and the description gets the required AI prefix.
   - **Parse & fill directly (no AI)** — sections extracted locally, no Ollama call (offline,
     fastest). Quality depends on clear headings in the document.
3. Open your Udemy course management page (`…/manage/…`) and click either:
   - **Start auto-fill (all 3 pages)** — navigates Goals → Landing → Messages, filling + saving each.
   - **Fill current page only** — fills just the page you're currently viewing (no navigation).
   Either way it uses the previewed content and never re-reads the file at this step.

The activity log records every step.

### Pages & fields filled
- **Intended learners** (`/manage/goals`): What students will learn, Requirements / prerequisites, Who this course is for.
- **Course landing page** (`/manage/basics`): Title, Subtitle, Description, Level, Category, **Sub-category**, "What is primarily taught".
- **Course messages** (`/manage/communications/messages`): Welcome message, Congratulations message.

### Content rules enforced
- **Title** ≤ 60 characters.
- **Subtitle** ≤ 120 characters.
- **Description** 250–350 words, and **always starts with**
  `This course contains the use of artificial intelligence.`
- **Learning objectives**: at least 4 (the extension adds rows and generates more if needed).
- **Welcome & Congratulations** messages always mention the **profile name**, the **"from" label**, and the **course name**.

---

## Install (unpacked)

1. Install **Ollama** and pull a model:
   - **macOS:** `brew install ollama` (or download from ollama.com/download), then `ollama serve` (or launch the app). Then `ollama pull llama3.1`.
   - **Windows:** download/run the installer from ollama.com/download (starts automatically), then `ollama pull llama3.1`.
   - **Linux:** `curl -fsSL https://ollama.com/install.sh | sh`, then `ollama pull llama3.1`.

   (The in-extension **Help & Setup** tab has the full step-by-step, including models and the
   `OLLAMA_ORIGINS` commands for each OS.)
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**,
   and select this folder.

   > Talking to Ollama just works — the extension strips the browser `Origin` header
   > from its Ollama requests via a `declarativeNetRequest` rule, so you do **not** need to
   > set `OLLAMA_ORIGINS`. (If you ever see a `403`, fully reload the extension so the rule
   > loads; as a last resort start Ollama with `OLLAMA_ORIGINS=*`.)

3. Click the extension's **⚙ Settings**:
   - Confirm the Ollama URL (`http://localhost:11434`), click **Test connection**.
   - Add one or more **profiles** (name + "from" label).
   - Optionally pick a default model and toggle auto-save.

---

## Usage

1. Click the extension icon. Select a profile + model, upload the document.
2. Click **Analyze & Improve with Ollama** and review/edit the generated content in the preview.
3. Go to your Udemy course → any `…/manage/…` page, then click **Start auto-fill**.
4. Watch the activity log. The extension drives the tab through all three pages.

> **Auto-save** is on by default — it clicks each page's **Save** button after filling.
> Turn it off in Settings if you'd rather review before saving.
>
> **Overwrite** is on by default — it replaces whatever is already in a field. Turn it off
> in Settings to keep any fields that already contain text (only empty fields get filled).

### Per-profile field prompts & on/off (v2.3)

Each **profile** has its own per-field configuration (Settings → a profile → "Field prompts &
on/off"). Every field comes **pre-filled with a relevant default prompt**. For each field you can:
- **Toggle it off** — that field is skipped entirely for this profile (not generated, not filled).
- **Keep the default prompt** — the fast built-in improvement is used (no extra AI call).
- **Edit the prompt** — that field is then improved using *your* instruction instead, which runs
  as one extra AI call when you Analyze & Improve.

When you pick a profile and run **Analyze & Improve**, only that profile's **enabled** fields are
processed, each with its own prompt. Profiles are fully independent — switching profiles never
mixes prompts or toggles.

---

## Upload a ready-made JSON (no AI, no parsing)

Instead of a document, you can upload a **`.json`** file whose fields are filled straight into
the course — no Ollama, no parsing. The popup loads it directly into the editable preview;
just click **Start auto-fill**. See [`sample-course.json`](sample-course.json) for a full example.

```json
{
  "title": "string (≤ 60 chars)",
  "subtitle": "string (≤ 120 chars)",
  "description": "string (ideally 250–350 words; start with: This course contains the use of artificial intelligence.)",
  "level": "Beginner Level | Intermediate Level | Expert Level | All Levels",
  "category": "a valid Udemy category, e.g. Personal Development",
  "subcategory": "a valid sub-category of that category, e.g. Self Esteem & Confidence",
  "primarilyTaught": "short phrase",
  "objectives": ["string", "string", "...(4+ recommended)"],
  "requirements": ["string"],
  "audience": ["string"],
  "welcomeMessage": "string",
  "congratulationsMessage": "string",
  "curriculum": [
    { "title": "Section title", "lectures": ["Lecture 1", "Lecture 2"] }
  ]
}
```

Notes:
- All keys are optional — omit any you don't want filled (or set its array empty).
- `objectives` / `requirements` / `audience` / each section's `lectures` are arrays of strings.
- `level` / `category` / `subcategory` must match Udemy's option text (matched case-insensitively).
- `curriculum` only fills if **"Also build the Curriculum"** is enabled in Settings.
- Optional `"_fields"`: a map like `{ "title": { "en": false } }` to skip specific fields.

## Running the tests

A headless suite (`tests/run-all.js`) checks the AI pipeline (against your real Ollama),
error handling, parsing, the content-script DOM filling (mock Udemy pages via jsdom), and
the profiles/settings logic:

```powershell
npm install        # installs jsdom (dev only — not part of the extension)
node tests/run-all.js
```

`node_modules/`, `tests/`, and `test-harness.js` are dev-only; Chrome ignores them when
loading the unpacked extension.

---

## Notes & limitations

- **Ollama 403 / "blocked"**: handled automatically by the bundled `rules.json`
  (`declarativeNetRequest`) which removes the `Origin` header. If you still see it, fully
  reload the extension at `chrome://extensions` (the rule loads on (re)install); as a last
  resort start Ollama with `OLLAMA_ORIGINS=*`.
- **Udemy DOM**: fields are located by their visible labels/placeholders (Udemy's CSS class
  names are randomized). If Udemy changes their form layout, the relevant selector in
  `src/content/udemy-filler.js` may need a small update — the activity log will tell you
  exactly which field wasn't found.
- The model only sees the **first ~14,000 characters** of very large documents.
- Quality depends on the model — `llama3.1` or larger is recommended over tiny models.

## Project layout

```
manifest.json
src/
  background.js            orchestration (Ollama + page navigation)
  content/udemy-filler.js  fills the Udemy DOM
  lib/
    ollama.js              Ollama HTTP client
    generator.js           generate + test/repair content
    prompts.js             prompt templates + helpers
    udemy-data.js          categories / levels / limits
    parser.js              docx/pdf/txt parsing (popup)
    logger.js              persistent activity log
  popup/                   the action popup UI
  options/                 settings + profile management
  vendor/                  mammoth.js, pdf.js
icons/
sample-course-outline.md   example input you can test with
```
