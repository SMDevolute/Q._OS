# CLAUDE.md — Q. Operating System

> Read this first. It's the master brief for this repo. Deeper detail lives in `docs/`.
> **Do not "helpfully" re-platform or rewrite the app** (see § How the app is built) without
> being explicitly asked — it is intentionally framework-free and deploys as static files.

---

## 1. What Q. OS is

**Q. Operating System ("Q. OS")** is *the capital operating model* — one system that runs a
company's investors and counterparties across the full lifecycle of a raise, and the raises after
it. Tagline: **"Every investor, every round, one system."**

It is organised as **three modules** (the "three movements"):

| Module | Status | What it does | Sub-areas |
|---|---|---|---|
| **Acquire** | **Live / fully built** | Find, approach and win the investors a round needs. | Database & funnel · Campaigns · Call sheets · Deal strategy · Mandate |
| **Close** | Scaffold | From intent to signature, nothing left for the buyer to find first. | Dataroom & Q&A · Findings · Term sheets |
| **Retain** | Scaffold | Keep shareholders warm, so the next round starts halfway done. | Updates · AGM & board pack · Cap table |

### The mental model — three layers
```
Q. OS (the product)
  └─ Workspace (one per client company, e.g. "Northwind Materials")
       └─ Modules (Acquire / Close / Retain) — each with its own screens
```
A **workspace** is a single company's instance. Everything currently in the repo shows the
**fictional demo workspace "Northwind Materials"** (a €15M Series A). **There is no real client
data in this repo.**

---

## 2. Repo layout

```
index.html                     → redirect into the shell (site entry point)
Q. Operating System.dc.html    → the SHELL: marketing landing → workspace launcher → routes to modules
support.js                     → the runtime (REQUIRED; a copy sits next to every .dc.html)
assets/                        → Q. OS brand assets (Evolute wordmarks)
acquire/  Acquire.dc.html + support.js + assets/   → Acquire module (the full, working tool)
close/    Close.dc.html   + support.js + assets/   → Close module (scaffold)
retain/   Retain.dc.html  + support.js + assets/   → Retain module (scaffold)
docs/                          → the deep-dive docs referenced below
```
Modules link to each other and back to the shell with **relative paths** (e.g.
`../Q.%20Operating%20System.dc.html`). Keep the folder layout intact.

---

## 3. How the app is built (important)

The app is authored as **Design Components (DC)** — an intentional, framework-free system:

- Each screen is a `*.dc.html` file that **opens directly in a browser** and is rendered by
  **`support.js`** (the DC runtime, which ships in the repo). **No build step, no npm, no bundler.**
- A `.dc.html` file contains an `<x-dc>` template (HTML with `{{ }}` value holes and
  `<sc-for>` / `<sc-if>` control flow) plus a `class Component extends DCLogic { renderVals() {…} }`
  logic class. `renderVals()` returns the values/handlers the template binds to.
- Styling is plain CSS in a `<helmet><style>` block; fonts via Google Fonts links.

**This runs as static hosting exactly as-is.** Serve the files; the browser does the rest.
Do **not** convert it to React/Vue/etc. unless the team explicitly decides to re-platform — that
is a separate, deliberate project, not a cleanup task. If you re-platform, treat the `.dc.html`
files as the source-of-truth spec.

See `docs/ARCHITECTURE.md` for the DC model in detail and `docs/DESIGN_SYSTEM.md` for the visual system.

---

## 4. Data & state (today)

- All data is **local to the browser** (`localStorage`). Nothing is shared between users yet.
- Acquire's storage keys: `q_os_acquire_v2` (records) and `q_os_acquire_round_v2` (round).
- Acquire's `CONFIG` block (top of the `Component` class in `acquire/Acquire.dc.html`) holds the
  per-workspace settings: `workspace`, `client`, `roundTargetM`, `subtitle`, `owners`,
  `seedInvestors`, and **`syncUrl` (currently `""` — sync is intentionally disconnected)**.

---

## 5. Backend / multiplayer (to build)

There is **no backend yet** and **no credentials in this repo** — none exist. The tool it was
forked from used a Cloudflare Worker owned by a third party; that connection was **removed** on
purpose. The plan is a fresh Cloudflare Worker + storage, owned by us.

Full design, the Cloudflare setup, and the exact secrets to create are in
**`docs/BACKEND_AND_SYNC.md`**. Short version: build a Worker with a KV/D1/Durable-Object store
for shared workspace data + view/edit access codes, then set Acquire's `CONFIG.syncUrl` to the
Worker URL. Secrets live in Cloudflare (Wrangler secrets / dashboard) — **never commit them.**

---

## 6. Deployment

Static site → **Cloudflare Pages**. Step-by-step in **`docs/DEPLOYMENT.md`**.
- Framework preset: **None**, build command: **empty**, output dir: **`/`**.
- Entry: `index.html` redirects to `Q.%20Operating%20System.dc.html`.
- Auto-deploys on every push to `main`.

---

## 7. Current status & roadmap

**Built:** shell (landing + launcher + module switcher), Acquire (full working module on neutral
demo data), Close & Retain (scaffolds with their sub-areas laid out).

**Next up:**
1. **Deploy** to Cloudflare Pages → live URL.
2. **Sync backend** (Worker) → turn Acquire from local-only into real multiplayer.
3. **Deep-copy sweep of Acquire:** the main screens read as a neutral "Series A", but the
   *Deal strategy / Coverage* and *Post-FID* screens, plus the **"KPMG" advisor concept** baked into
   the funnel, still carry domain language from the original build. Genericise or blank these.
4. **Build out Close and Retain** from scaffold to working modules.

See `docs/ROADMAP.md` for detail.

---

## 8. History (context)

Q. OS was forked from a working investor-relations tool ("RESiLICON — IRM") and generalised into a
product. Client-specific data, branding, sync wiring, and one-time migration code were stripped and
replaced with the fictional **Northwind Materials** demo. Item 7.3 above is the remaining cleanup.
