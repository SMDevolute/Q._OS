# Roadmap & Status — Q. OS

## Done
- **Shell**: marketing landing → workspace launcher → module cards + sidebar Modules switcher.
- **Acquire** (Live): full working module on neutral demo data (workspace "Northwind Materials",
  €15M Series A) — dashboard, dealflow/funnel, call sheets, campaigns, deal strategy, mandate,
  investor database, documents.
- **Close** (scaffold): Overview + Dataroom & Q&A / Findings / Term sheets placeholders.
- **Retain** (scaffold): Overview + Updates / AGM & board pack / Cap table placeholders.
- Sync disconnected (local-only); generic storage keys; Helios-specific data + migration code removed.

## Next
1. **Deploy** to Cloudflare Pages → live URL (see `DEPLOYMENT.md`).
2. **Sync backend** Worker → real multiplayer (see `BACKEND_AND_SYNC.md`).
3. **Acquire deep-copy sweep.** Main screens read neutral, but these still carry domain language
   from the original build and need genericising or blanking:
   - *Deal strategy / Coverage* screen (mentions a specific project financing, fee deferrals).
   - *Post-FID* screens (project-scale raise narrative).
   - The **"KPMG" advisor concept** woven through the funnel (a "KPMG" entry column, notify warnings,
     "longlist" language). Decide: generalise to a neutral "advisor/inbound" concept, or remove.
4. **Build out Close** from scaffold: permissioned dataroom + document tree, a Q&A log (ask once /
   reuse), a findings register (issue · owner · severity · status).
5. **Build out Retain** from scaffold: recurring investor-update composer + lists, AGM/board pack
   assembly, a living cap table that feeds the next round's modelling in Acquire.
6. **Cross-module data flow** ("every phase feeds the next round"): shared workspace data so a closed
   investor in Acquire appears in Retain's cap table, etc. Depends on the sync layer.

## Working notes
- Keep the DC/static architecture unless a re-platform is explicitly decided.
- One workspace per client company; "Northwind Materials" is demo only — no real client data in repo.
