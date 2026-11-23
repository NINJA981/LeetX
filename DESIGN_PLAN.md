# LeetX Squads: design audit and improvement plan

Scope: the extension UI. That is the toolbar popup (`popup/`) and the on-page overlay (`styles/content.css`, `scripts/content.js`). The landing page is out of scope.

Status: phases 1 to 5 implemented (see section 5).

Method: read every view and stylesheet, rendered each screen in headless Chrome against a mocked extension API (light, dark and neon), and measured contrast with the WCAG formula.

## 1. What is already good (keep)

- Flat canvas with 1px structure, colour reserved for meaning (streak, difficulty, state).
- Plain-DOM component kit (`ui.js`) with no `innerHTML`, a real a11y baseline (roles, `aria-*`, keyboard tabs, reduced-motion).
- Copy is specific and in the product's voice ("Nobody has solved yet today. Be first.").
- Cache-first rendering, so the popup opens instantly.

## 2. Audit findings

| # | Finding | Evidence | Severity |
| --- | --- | --- | --- |
| A1 | **No real typeface.** `"Inter var", Inter` is never bundled, so the UI renders as Segoe UI on Windows, SF on macOS, Roboto on Linux. The `cv11`/`ss01` font features are no-ops. The product has no typographic identity and looks different per OS. | `popup/style.css:8,186` | High |
| A2 | **Body-size text fails WCAG AA.** `--text-3` is 3.4–3.6:1 on light, 3.7–3.9:1 on dark, 4.1–4.3:1 on neon, and is used for 11–12px meta text everywhere. Medium/Easy difficulty text is 3.4:1. White-on-green week cells are 3.3:1. | contrast script, `style.css:26-45,63-90` | High |
| A3 | **Brand mismatch.** The icon and the neon theme are hot magenta (`#FF2D8B`). Light and dark themes use a rose-red (`#E11D48`/`#FB7185`), a different hue. The default look doesn't match the brand mark. | `style.css:29,68,146` | Medium |
| A4 | **The hero is generic.** A flame, a big number and seven identical green slabs is the template every habit tracker uses. Seven solid green blocks are also the loudest thing in the popup, louder than the number. Nothing is specific to LeetX (commits, squads, a line you don't break). | `today.js:75-139`, screenshot | High |
| A5 | **Type scale is ad hoc.** 17 distinct sizes (10.5, 11, 11.5, 12, 12.5, 13, 14, 15, 16, 17, 18, 20, 24, 40, 44…). | `grep font-size` | Medium |
| A6 | **View re-animates on every refresh.** `render()` rebuilds `<main class="view">` and `.view` always carries `animation: view-in`, so a storage change or a 30s squad poll replays the fade-and-slide. | `app.js:160`, `style.css:350` | Medium (bug) |
| A7 | **Focus ring changes shape.** `:focus-visible` forces `border-radius: 6px`, so pills, chips, avatars and switches turn into rounded rectangles while focused. | `style.css:200-204` | Medium (bug) |
| A8 | **Native `confirm()` in a popup.** Leave squad and Forfeit use the browser dialog. It ignores the theme, and can dismiss the popup in Firefox. | `squad.js:218`, `duels.js:144` | Medium |
| A9 | **Theme tokens are copy-pasted.** The 30-line dark block is duplicated for `system`; avatar and freeze colours are re-declared three times each. Light/dark can drift. | `style.css:95-133,534,1251-1262` | Low (maintainability) |
| A10 | **Hard-coded colours/hacks.** Streak-freeze blues (`#0284C7`, `#7DD3FC`, `#38BDF8`) are repeated. `.week-bar-fill[style*="height: 0%"]` matches an inline style string. `.hero-sub` is declared twice. | `style.css:662,1250,1256,1317` | Low |
| A11 | **Template tells.** All-caps tracked labels in the overlay ("ACCEPTED") and the roadmap "NEXT" tag. | `content.css:40-46`, `style.css:1126` | Low |
| A12 | **Overlay low-contrast text.** `#6B6F7A` on `#16181D` is about 3.4:1; the idle companion pill is at 72% opacity. | `content.css:74,178,196,128` | Medium |
| A13 | Landing-page copy in `frontend/` has orphaned files (`style.css`, `app.js` aren't referenced by `index.html`) and a stale `DESIGN.md`. | `frontend/` | Out of scope, noted |

## 3. Design direction

**Subject and job.** A developer's daily LeetCode habit, shared with friends, backed up as git commits. The popup is opened for two seconds a day: *am I safe today, and what's next?*

**The one memorable thing: the streak is a line you don't break.** It borrows from the git commit graph, which is native to this audience and to the GitHub backup. Days are nodes on a rail. Solved days are filled nodes joined by a solid line, a freeze is an ice node that keeps the line intact, and today waits at the end of a dashed segment until you solve. The rail replaces the seven green slabs and makes the streak's continuity visible, not just its count.

Everything else stays quiet.

### Tokens

| Role | Light | Dark | Neon |
| --- | --- | --- | --- |
| Brand accent (matches the icon) | `#D3206F` | `#FF5FA8` | `#FF2D8B` |
| Accent text | `#B0165A` (6.8:1) | `#FF8DC0` | `#FF7AB8` |
| Meta text (`--text-3`) | `#6A6B75` (4.9:1) | `#8A8D97` (5.4:1) | `#9A8CB4` (6.1:1) |
| Easy / Medium text | `#0B7F59` / `#A15F00` (5.0:1) | unchanged | unchanged |
| Done node (`--success`) | `#15803D` (5.0:1 with white) | `#4ADE80` | `#3DF5A0` |
| Ice (streak freeze) | `#0369A1` | `#7DD3FC` | `#7DD3FC` |

**Type.** Two bundled variable fonts (SIL OFL, latin subset, about 87 KB total).
- UI: **Schibsted Grotesk**, a grotesque with open apertures that stays legible at 12px.
- Data: **JetBrains Mono**, used only where the value is code-like or a counter: the hero streak, duel clock, squad code, personal-best times and `kbd`. It is not used for generic small labels.

**Scale** (7 steps, replaces 17): micro 11, meta 12, body 13, title 14, heading 17, metric 24, hero 60. Code and clock sizes (20, 40) stay as dedicated values.

**Layout and alignment.** Left-aligned content in a 380px column with 16px gutters. Hierarchy comes from type scale and 1px dividers, with no card-per-item. Cards (`--bg-sunken`) are kept only for the three "objects" (daily problem, squad challenge, duel arena).

```
┌──────────────────────────────────────┐
│ ⚡ LeetX                 🔥5  Lv5  ⚙ │
│ Today  Progress  Squad  Roadmap      │
│──────────────────────────────────────│
│ 🔥 12 days                    ◯ 2/2  │  60px mono number
│ ● Goal hit: 2 solved today    today  │
│ Best 21 days   ❄ 1 freeze            │
│                                      │
│  M    T    W    T    F    S    S     │
│  ●────●────❄────❄────●────●────◉     │  the streak rail
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ Daily challenge · Oct 11         │ │
│ │ 146. LRU Cache         [Solve →] │ │
│ └──────────────────────────────────┘ │
```

**Motion.** One orchestrated moment: when the streak grows, the number pops (already built) and the rail's newest segment draws in. Everything else only answers a click. View transitions run only on tab change (A6).

### Review against the brief

- *Would I arrive at the same hero for any habit app?* The first draft (flame, number, ring) is the default, so the rail replaced it.
- *Is "mono for numbers" a tell?* Only when applied to small labels. Here it is limited to five code-like values, which is why it's not applied to the squad leaderboard's XP/streak meta.
- *Warm cream or acid-green defaults?* Neither. The palette is brand-derived (magenta from the icon), with green and ice used only as state colours.

## 4. Work plan

| Phase | Changes | Files |
| --- | --- | --- |
| 1. Foundations | Bundle fonts and add `@font-face`; type-scale tokens; contrast-safe tokens; brand accent; `--ice` token; resolve `system` theme in `theme-boot.js`/`theme.js` and delete the duplicated `@media` block | `assets/fonts/*`, `popup/style.css`, `popup/theme*.js` |
| 2. Signature | Streak rail on Today; hero number in mono at 60px; rail draw-in on streak growth | `popup/views/today.js`, `style.css` |
| 3. Interaction | Animate the view only on tab change; focus ring keeps element shape; in-app confirm dialog (Leave squad); Forfeit uses the existing two-step button; replace the `style*=` hack with a class; merge duplicate `.hero-sub`; sentence-case "Next" | `app.js`, `ui.js`, `squad.js`, `duels.js`, `progress.js`, `style.css` |
| 4. Overlay | Sentence-case eyebrow; contrast-safe greys; companion pill at 88%; mono counters | `styles/content.css` |
| 5. Verify | `npm test`, `npm run lint`, before/after screenshots in all three themes and every tab; update `ARCHITECTURE.md` (tokens/fonts) | |

Not doing: a redesign of Squad/Duels/Roadmap/Progress layouts. They get the new tokens, type and contrast, which fixes most of the audit. Their structure already follows the "no card per row" rule.

## 5. Result

Done: A1 to A12 (the landing page, A13, was left alone). Unit and Python tests pass and `npm run lint` is clean. Every tab was checked in headless Chrome; the Today tab in light, dark and neon, including the frozen-day and not-yet-solved rail states.

Known trade-offs:
- JetBrains Mono's zero has a dot inside, so a streak of 0 reads as a dotted zero. It suits the developer tone, but swap the hero font if it bothers you.
- The rail's draw-in only plays when the streak grew since the popup was last opened.
- Not verified in a real browser popup or Firefox: the checks used a mocked extension API, so load the unpacked extension once to confirm the fonts and the leave-squad dialog.
