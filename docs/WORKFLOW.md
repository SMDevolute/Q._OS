# Workflow — designing in the Claude tool, shipping from the repo

How changes get from the **Claude design tool** (where the app screens are authored) into the
**repo** and out to the **live site**. Read this before dropping in a new export.

## Source of truth (agree on this)

To avoid clobbering each other, split ownership:

| Owns | What | Edited where |
|---|---|---|
| **Claude design tool** | The app itself — the `*.dc.html` screens, `support.js`, `assets/` | In the tool, then re-exported |
| **Repo / CLI** | Plumbing — `.github/workflows/`, `.gitignore`, `docs/`, git history, the future sync Worker | Directly in the repo |

**Do not hand-edit the `*.dc.html` app files in the repo** if someone is also editing them in the
tool — the next export will overwrite those edits. Infra files are safe: the export never contains them.

## The loop

1. **Design** in the Claude tool (produces the Design Component `.dc.html` files).
2. **Export** the bundle (a `.zip`) when ready to ship.
3. **Drop it into the repo** — put the `.zip` in the repo folder locally, or hand it to Claude Code
   in chat. **Do _not_ upload it through the GitHub web UI** (see "Why route it through the CLI").
4. **Integrate** (Claude Code does this): unzip, flatten the `q-os-deploy/` wrapper, overlay the app
   files, and **diff against the current repo** so the actual changes are reviewed before committing.
5. **Commit & push to `main`** → the GitHub Action auto-deploys to Cloudflare Pages →
   live at **https://q-os.pages.dev**.

## Why route it through the CLI (not GitHub directly)

- **Preserves infrastructure.** The tool's export contains **only app files** — not
  `.github/workflows/deploy.yml`, `.gitignore`, git history, or the sync Worker. Dumping the export
  straight over the repo would **wipe the auto-deploy setup**. Integrating via the CLI overlays the
  app files and keeps the plumbing intact.
- **Reviewable diffs.** Routing through the repo produces a real diff — you see exactly what changed
  instead of one giant "replaced everything" commit.
- **Handles the layout quirks.** The export nests everything under `q-os-deploy/` and the shell
  filename contains spaces; integration flattens to root (see `DEPLOYMENT.md`) so hosting stays clean.

## Deploy = just push

Once integrated, shipping is a `git push` to `main`. No dashboard, no manual deploy step. See
`DEPLOYMENT.md` for the Cloudflare Pages / GitHub Action details.
