# Deployment — Q. OS → Cloudflare Pages

The app is static (HTML + `support.js` + assets, no build). Host it on **Cloudflare Pages**.

## First deploy
1. Make sure the repo has everything from this bundle at its root, including `index.html`
   (redirects to the shell) and each module folder with its own `support.js` + `assets/`.
2. Commit & push to `main`.
3. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick `q-os`.
4. Build settings:
   - **Framework preset:** None
   - **Build command:** *(leave empty)*
   - **Build output directory:** `/`
5. **Save and Deploy.** You get a `q-os.pages.dev` URL. It **auto-redeploys on every push to `main`.**

## Verify
- Root URL redirects to the landing page.
- "Enter workspace" → launcher; **Acquire** card opens the working module; **Close/Retain** open
  their scaffolds; each module's `← Q. OS` returns to the shell.

## Notes / gotchas
- The shell filename contains spaces (`Q. Operating System.dc.html`); links use `%20`. `index.html`
  handles the clean entry so users never type it. Keep `index.html` at root.
- No redirects/rewrites config needed for the basic static deploy. If you later add one, don't break
  the relative module paths.
- Custom domain: add it in the Pages project → Custom domains, once DNS is on Cloudflare.

## Wrangler (optional, later)
When the sync Worker exists (see `BACKEND_AND_SYNC.md`), you can manage both from Wrangler and wire
a single deploy. Not required for the static site.
