# Architecture

LeetX Squads is a Manifest V3 extension with no build step: plain ES modules, loaded directly by the browser.

```
leetcode.com tab                     background worker                         services
┌──────────────────┐  SYNC_SUBMISSION  ┌────────────────────────────┐
│ scripts/content  │ ───────────────▶ │ scripts/background          │ ─▶ LeetCode GraphQL (verify, code)
│  detect Accepted │ ◀─────────────── │  streak/XP · badge · alarms │ ─▶ GitHub REST (commit, catalog)
│  toast (shadow)  │   result + toast  │  squad poll → notifications │ ─▶ Firestore REST (squad, duels)
└──────────────────┘                   └──────────────┬─────────────┘
                                                      │ chrome.storage.local (single source of truth)
                                       ┌──────────────┴─────────────┐
                                       │ popup/ (Today · Squad ·     │
                                       │ Duels · Roadmap · Settings) │
                                       └────────────────────────────┘
```

## Modules

| File | Responsibility |
| --- | --- |
| `scripts/core.js` | Pure logic shared everywhere: dates, streak maths, XP/levels, challenge catalog and matching, squad codes. Fully unit-tested. |
| `scripts/state.js` | `chrome.storage.local` helpers: defaults, v1 → v2 migration, profile, de-duplicated XP awards, duel record. |
| `scripts/firebase.js` | Anonymous Auth (token refresh, cross-context race handling), a small Firestore REST client (masks, `:commit` preconditions, queries) and the `Squads` / `Duels` APIs. |
| `scripts/leetcode.js` | GraphQL client using the user's own session. Paginates history with `lastKey` and backs off on HTTP 429. |
| `scripts/github.js` | Git Data API commits (fast-forward only, retried on 422), placeholder detection, README catalog. |
| `scripts/background.js` | The solve pipeline, badge, reminders, squad polling and the serialized GitHub queue. |
| `scripts/content.js` | Detects accepted submissions and renders feedback inside a closed shadow root, using `textContent` only. |
| `popup/` | `app.js` (shell, routing, live updates), `ui.js` (DOM builder, icons, components), `views/*` (one module per screen), `style.css` (design tokens, light/dark/neon themes, bundled Schibsted Grotesk + JetBrains Mono in `assets/fonts/`; see `DESIGN_PLAN.md`). |

## Solve pipeline

1. `content.js` starts watching when the user clicks **Submit** (or presses Ctrl/⌘+Enter), then waits for LeetCode's "Accepted" result.
2. It sends the submission id and slug to the worker. The worker only accepts this message from a `https://leetcode.com/` tab.
3. The worker de-duplicates by submission id, then **verifies** the submission through `submissionDetails` (`statusCode === 10`).
4. Local state is updated: `solve_history` (date → count), XP (new problem by difficulty, repeat solve 3, first solve of the day +10), the solved set and totals. It replies straight away so the toast shows instantly.
5. In the background it then:
   - checks the active duel (exact slug match) and claims the win,
   - posts a solve event to the squad and rotates the challenge if this solve completed it,
   - queues the GitHub commit.

Streaks are never stored. They're always derived from `solve_history` (`computeStreak`), so a missed alarm or a closed browser can't corrupt them.

## Habit features (all local, no backend)

| Feature | State (`chrome.storage.local`) | Logic (`core.js`) | Applied by |
| --- | --- | --- | --- |
| Streak freezes | `streak_freezes`, `frozen_days[]`, `freezes_used` | `earnsFreeze`, `applyStreakFreezes`: covers the gap before today only if *every* missed day can be covered and a streak sits behind it; idempotent | worker on start-up and every 15-minute tick; popup on open |
| Spaced review | `review_schedule{slug: {interval, reps, dueDate}}`, `reviews_done` | `newReviewEntry` (+3 days), `nextReview` (good ×2.5, hard ×1.2, again → 1 day, graduates past 120 days) | worker on solve (a due re-solve counts as *good*; new Medium/Hard solves are auto-scheduled); popup Got it / Again |
| Solve timing | `solve_times{slug: {best, last, difficulty}}` | `formatClock`, `median` | content script counts visible seconds per problem (kept in `sessionStorage` across reloads) and sends `solveSeconds` with the submission |
| Achievements | `achievements{id: unlockedAt}` plus counters | `ACHIEVEMENTS`, `achievementStats`, `newlyUnlocked` | `state.recordAchievements`. The first run records a silent baseline, and writes merge with the latest map, because the popup and the worker both record |
| Topic focus | none (derived) | `topicMastery` (NeetCode order), `weakestTopic`: the earliest topic under 60% | Progress tab |
| Contests & recap | `contests_cache`, `contest_notified[]`, `last_recap_week` | `weekSummary` | worker tick (contest list refreshed every 12 hours; reminder 15–45 minutes before; recap on Sunday after 18:00) |

The on-page companion asks the worker for `GET_PROBLEM_CONTEXT` (roadmap membership, best time, due review, streak). The worker only answers `leetcode.com` tabs. Notes are read and written directly in `chrome.storage.local` under `notes_<slug>`.

## Firestore data model

```
squads/{CODE}                      code, ownerUid, ownerName, challenge{…}, completedChallenges, squadXp, bannedUids[], schema: 2
squads/{CODE}/members/{uid}        uid, name, streak, todaySolved, todayDate, totalSolved, xp, joinedAt, lastActive
squads/{CODE}/events/{id}          type, actorUid, actorName, target*, problem{…}, challengeId, …, createdAt, expireAt
duels/{id}                         squadCode, challenger*, opponent*, format, difficulty, status, winner*, runtime, expireAt
duels/{id}/secret/problem          id, title, slug, difficulty, category
```

`expireAt` is there for a Firestore TTL policy. TTL needs the Blaze plan, so it isn't configured on the Spark project; enable it under Firestore → TTL if you upgrade.

`firestore.rules` enforces these guarantees, and `tests/firestore.rules.test.mjs` tests each one:

- **Identity is `request.auth.uid`.** Names never authorize anything. Users can only write their own member doc, and events are stamped with the author's own uid.
- **Squad codes are the invite secret.** `get` is allowed for signed-in users, `list` is denied, and only members can read the roster and feed.
- **Owner actions are enforced server-side:** kicks, the ban list, rerolls and ownership transfer (only to an existing member).
- **The feed is append-only.** Events are schema-checked: an allow-listed field set, length caps, `createdAt` within ±5 minutes of server time, and no free-text HTML field.
- **Challenge rotation** requires exactly one more completion and the matching reward. Rotations use an `updateTime` precondition through `:commit`, so two members finishing at once rotate it only once.
- **Duels are a state machine:** `pending → active | declined | cancelled` and `active → completed (winner = caller) | forfeited (winner = other)`. Only the two players can read a duel, and the problem doc stays hidden from the opponent until they accept.
- **v1 migration:** a v1 squad doc (no `ownerUid`) can be replaced once, by the first v2 client, with a valid v2 doc.

## Tests

| Suite | Command | Covers |
| --- | --- | --- |
| Unit | `npm run test:unit` | core logic, GitHub commit semantics, LeetCode pagination |
| Rules | `npm run test:emulator` | every security property above, on the real emulator |
| Multiplayer e2e | `npm run test:emulator` | `firebase.js` driven as several users against the emulator and real rules |
| Package | `python -m unittest discover -s tests` | manifest least privilege, datasets, no HTML sinks in UI code, zip contents |
