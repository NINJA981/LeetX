# LeetX Design System Specification

## 1. Core Philosophy
- **Developer-First**: Looks and feels like a native developer tool (inspired by Linear, GitHub CLI, and modern IDEs).
- **Anti-Card Hierarchy**: Content sits directly on the canvas using typographic scale, spacing, and subtle 1px dividers rather than redundant floating cards.
- **Popup-Optimized**: Designed for high information density within a ~385px browser extension viewport with zero horizontal overflow.
- **Restrained Semantics**: Color carries explicit functional meaning (success, warning, danger, difficulty).

---

## 2. Design Tokens

### Color Palette

| Token | Light Mode | Dark Mode | LeetX Mode |
|---|---|---|---|
| `--bg-canvas` | `#FBFBFC` | `#0B0F17` | `#0D1117` |
| `--bg-surface` | `#FFFFFF` | `#131923` | `#161B22` |
| `--bg-surface-subtle` | `#F1F5F9` | `#1A2230` | `#1F242C` |
| `--bg-surface-active` | `#E2E8F0` | `#242E40` | `#2D333B` |
| `--text-primary` | `#0F172A` | `#F8FAFC` | `#F0F6FC` |
| `--text-secondary` | `#64748B` | `#94A3B8` | `#8B949E` |
| `--text-muted` | `#94A3B8` | `#64748B` | `#6E7681` |
| `--border-subtle` | `#E2E8F0` | `#1E293B` | `#30363D` |
| `--border-strong` | `#CBD5E1` | `#334155` | `#484F58` |
| `--brand-accent` | `#E11D48` | `#F43F5E` | `#FF2D55` |
| `--brand-accent-subtle` | `rgba(225, 29, 72, 0.08)` | `rgba(244, 63, 94, 0.12)` | `rgba(255, 45, 85, 0.15)` |

### Semantic Colors
- **Easy / Success**: `#059669` (bg: `rgba(5, 150, 105, 0.10)`)
- **Medium / Warning**: `#D97706` (bg: `rgba(217, 119, 6, 0.10)`)
- **Hard / Danger**: `#DC2626` (bg: `rgba(220, 38, 38, 0.10)`)

---

## 3. Typography Hierarchy

| Level | Size | Weight | Line Height | Usage |
|---|---|---|---|---|
| **Hero Metric** | `26px` | `700` | `1.1` | Streak counter, total solved |
| **Section Title** | `13px` | `600` | `1.3` | Section anchors, group labels |
| **Micro Eyebrow** | `10px` | `600` | `1.2` | Tiny uppercase metadata (letter-spacing: `0.06em`) |
| **Body Primary** | `12.5px` | `500` | `1.4` | Problem titles, table rows, button labels |
| **Body Secondary** | `11.5px` | `400` | `1.4` | Subtitles, timestamps, notes |
| **Code / Tabular** | `11.5px` | `500` | `1.2` | Monospace numbers, room codes, rankings |

---

## 4. Component Rules

1. **Header**: Compact 44px bar. Left: Brand icon + `LeetX` (`SQUADS` in muted badge). Right: inline `🔥 15` and `XP 305` utility pills.
2. **Segmented Navigation**: Flat horizontal bar with subtle sliding pill or border-bottom active indicator.
3. **Problem Rows (Roadmap)**:
   - Default: `#ID Title Difficulty Status`.
   - Hover: Discloses quick action icons (`Note`, `LeetCode ↗`).
4. **Duels View**:
   - Idle State: Clean configuration form + 3-column stats row.
   - Active Duel State: Focused battle arena with match countdown timer and live status.
5. **Squad View**: Continuous room format. Distinct hierarchy for room codes, member leaderboard, and live activity feed.
