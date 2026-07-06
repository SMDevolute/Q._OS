# Architecture — Q. OS

## The Design Component (DC) system

Every screen is a `*.dc.html` file rendered by **`support.js`** (the runtime, committed in the repo).
It is framework-free and runs from static files — **no build, no npm, no bundler.**

A `.dc.html` has two parts:

1. **Template** — an `<x-dc>` block of HTML with:
   - `{{ path }}` **value holes** — dotted lookups only (`{{ investor.name }}`, `{{ $index }}`),
     filled by the logic class. Not expressions.
   - `<sc-for list="{{ items }}" as="it">…</sc-for>` — repetition.
   - `<sc-if value="{{ flag }}">…</sc-if>` — conditionals.
   - Event handlers as whole-attribute bindings: `onClick="{{ handler }}"`.
   - Styling is plain CSS in a `<helmet><style>` block at the top; fonts via Google Fonts `<link>`.

2. **Logic class** — `class Component extends DCLogic { state = {…}; renderVals() { return {…} } }`.
   `renderVals()` returns the flat object the template binds to (values, arrays, and handler fns).
   Standard React-class lifecycle is available (`componentDidMount`, `setState`, etc.).

### Why it matters for this repo
- It is **deployable as static files** with no toolchain. That's a feature — keep it.
- If you edit a screen, edit the template + `renderVals()` in the same `.dc.html`.
- Each folder that holds a `.dc.html` also holds its own `support.js` and `assets/` so the module
  opens standalone. Don't remove those copies.

## App structure

- **Shell** (`Q. Operating System.dc.html`): gated by an `entered` flag in `sessionStorage`
  (`q_shell_entered`). `onLanding` shows the marketing landing; `showApp` shows the workspace
  launcher (sidebar + three module cards + a Modules switcher). Module cards/links are plain
  relative `<a href>`s into `acquire/`, `close/`, `retain/`.
- **Acquire** (`acquire/Acquire.dc.html`): the full tool. Single big `Component` class. Screens are
  `<section class="screen {{ secX }}">` toggled by `activeSection` (a number). Nav groups + section
  routing are built in `renderVals()`. Opens straight to its dashboard; a `← Q. OS` link returns to
  the shell. Landing markup exists but is bypassed (`entered: true`).
- **Close / Retain** (`close/…`, `retain/…`): lightweight scaffolds — a `sec` index (0–3) toggles an
  Overview + three "in prep/roadmap" workstream screens. Same sidebar chrome and `← Q. OS` link.

## Routing recap
- Between modules: relative `<a href>` navigation (full page loads). This is deliberate — each
  module is its own sandboxed page and they share the same origin (so `localStorage` is shared
  across them when we add the sync layer).
- Within a module: `setState` on the section index; screens show/hide via an `.active` class.
