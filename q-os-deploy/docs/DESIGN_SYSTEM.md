# Design System — Q. OS

The look is calm, editorial, document-like — not a typical dashboard. Follow it exactly.

## Typography
- **Display / numbers / brand:** `"Space Grotesk"` (weights 400–700). Used for the `Q.` brand,
  page titles (`h1.title`), module names, and big figures. Tight tracking (`letter-spacing: -0.02em`).
- **Body / UI:** `"Inter"` (weights 300–700). Base body weight is **300**.
- Load both via Google Fonts in each file's `<helmet>`.

## Colour tokens (hex — used literally in the CSS)
| Role | Value |
|---|---|
| Ink / near-black (brand, headings) | `#192432` / `#121923` |
| Page background (cream) | `#FBFAF8` |
| Sidebar background | `#f4f3ef` (cards `#efede7`) |
| Primary blue (accent, focus, links) | `#2B5C87` |
| Deep blue (badges/text) | `#1E466B` |
| Blue tint (badge bg) | `#D3E2F0` / `#E6EDF4` |
| Green (live / committed) | `#2F7D5B` on `#E7F2EC` |
| Warm stone (muted accent) | `#C8C3B5` |
| Muted grey text | `#989CA3` / `#6b7480` |
| Borders / rules | `#e6e3dc` / `#eceae4` |

## Status badge palette
- **Live** → green: text `#2F7D5B`, bg `#E7F2EC`.
- **In prep** → blue: text `#1E466B`, bg `#D3E2F0`.
- **Roadmap / soon** → grey: text `#6b7480`/`#8a8f97`, bg `#EDEBE4`.

## Components (established patterns)
- **Sidebar** (252px, sticky): brand `Q.` + "Capital Operating Model" eyebrow, a **Workspace** card,
  nav, and a "Powered by Evolute" footer.
- **Module cards** (launcher): white, `border-radius: 14px`, `1px #e6e3dc` border, hover lifts with a
  soft shadow; Space-Grotesk module name + status badge + description + a footer meta line.
- **Screens**: `56px clamp(28px,4.5vw,72px)` padding, `max-width: 1080px`; eyebrow (uppercase, tracked)
  → `h1.title` → thin rule → `.lead-p` intro.
- **Tables / funnel / call sheets** (Acquire): dense, tabular-nums, quiet borders, pill-shaped
  stage/confidence selectors. Reuse these before inventing new patterns.

## Principles
- Minimal, no slop. No gradient soup, no emoji, no rounded-box-with-left-accent clichés.
- Generous whitespace; type does the work. Numbers in `Space Grotesk`, tabular where aligned.
- Inline/flex/grid with `gap`; avoid ad-hoc margins between UI siblings.
