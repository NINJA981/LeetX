# LeetX Squads

A browser extension that turns LeetCode practice into a daily habit you keep with friends.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen) ![Chrome · Edge · Brave · Arc · Firefox](https://img.shields.io/badge/browsers-Chrome%20%C2%B7%20Edge%20%C2%B7%20Brave%20%C2%B7%20Arc%20%C2%B7%20Firefox-blue)

- **Streaks that stick.** Your streak lives on the toolbar icon. It turns amber when today isn't done and red in the last three hours, and one evening reminder arrives only if you haven't solved yet.
- **Streak freezes.** You earn one every 7 streak days (up to 2). If you miss a day, a freeze covers it automatically, so one bad day doesn't erase a month of work.
- **A companion on LeetCode.** A small pill on every problem page shows your streak and a solve timer that only counts while the tab is visible. It also opens a notes panel that's synced to GitHub. The confirmation after an accepted solve shows your time, personal bests, freezes and achievements.
- **Smart reviews.** New Medium and Hard solves come back for review after 3 days. Rate each one *Got it* or *Again* and the gaps grow (3 → 8 → 20 → 50 days). Re-solving a due problem counts as the review.
- **Progress.** Topic mastery with a "focus next" pick that follows NeetCode order, median solve times by difficulty, this week vs last, a 6-month activity heatmap and 21 achievements.
- **Squads.** Share a 6-character code. You'll see who has solved today, nudge whoever hasn't, and clear rotating team challenges together.
- **1v1 duels.** Race a squadmate on the same hidden problem. It's revealed when they accept, and the first accepted submission wins.
- **GitHub backup.** Every accepted solution is committed to a repo you own (private by default), with runtime, memory and your notes, plus a README catalog. A one-click sync backfills your full history.
- **Roadmaps.** Blind 75 and NeetCode 150, with progress per topic and notes per problem.
- **Rhythm.** A reminder about 30 minutes before each LeetCode contest, and a Sunday-evening recap of your week. Both can be turned off.

Keyboard shortcuts in the popup: `1`–`4` switch tabs, `/` searches the roadmap, `,` opens settings.

## Install

**Download a release** (recommended):

| Browser | Package |
| --- | --- |
| Chrome, Edge, Brave, Arc | [leetx-chrome.zip](https://github.com/NINJA981/LeetX/releases/latest/download/leetx-chrome.zip) |
| Firefox | [leetx-firefox.zip](https://github.com/NINJA981/LeetX/releases/latest/download/leetx-firefox.zip) |

Unzip it, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the folder.
On Firefox, open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → choose `manifest.json`.

**Or use the installer**, which fetches the latest release and copies the folder path to your clipboard:

```powershell
# Windows
irm https://raw.githubusercontent.com/NINJA981/LeetX/main/install.ps1 | iex
```

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/NINJA981/LeetX/main/install.sh | bash
```

## Getting started

1. Sign in to [leetcode.com](https://leetcode.com) in the same browser.
2. Open the LeetX popup → **Get started**.
3. *(Optional)* Connect GitHub: click **Connect with GitHub** and approve access. LeetX creates `leetcode-submissions` (private unless you switch it off) and backfills your accepted solutions. Prefer a token? Open **Use a personal access token instead** and paste one with the `repo` scope (fine-grained tokens work with **Contents** and **Administration** write access).
4. Solve something. You'll see a confirmation on the LeetCode page and your streak updates on the toolbar.

## Privacy

| Data | Where it goes |
| --- | --- |
| Your code, notes and runtime stats | Only to **your** GitHub repository, via `api.github.com` |
| GitHub token | Stays in this browser's extension storage. During one-click sign-in it passes once through a small Cloudflare Worker (`auth-worker/`) that holds the OAuth client secret; the Worker does not store it. Sign-in asks for the `repo` scope, so use the personal-access-token option with a fine-grained token if you want narrower access. |
| Display name, streak, solve counts, titles of problems you solve, duel results | Your squad, via Firebase. Only members of your squad can read it. |
| Everything else (history, XP, notes, reviews) | Stays in this browser |

Squads use Firebase Anonymous Auth, so there are no accounts and no email addresses. Turn off **Share my solves** in Settings to stop posting solves to your squad.

## Development

The extension ships as plain ES modules with no build step. Node, Java 21+ and Python are only needed for tests and packaging.

```bash
npm install
npm test                 # unit tests + package/structure checks
npm run test:emulator    # security rules + multiplayer e2e on the Firestore emulator
npm run package          # dist/leetx-chrome-vX.Y.Z.zip and dist/leetx-firefox-vX.Y.Z.zip
```

Load the repository folder directly with **Load unpacked** while developing. See [ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit together, including the data model and security rules.

### Releasing

1. `python scripts/package.py minor` bumps `manifest.json` and `package.json`.
2. Commit, then tag `vX.Y.Z` and push the tag. CI runs every test suite, checks that the tag matches the manifest, and attaches the zips to a GitHub Release.

### Deploying the backend

The rules and indexes in this repo are the source of truth for the `leetsync-squads-app` Firebase project:

```bash
npx firebase deploy --only firestore:rules,firestore:indexes --project leetsync-squads-app
```

Anonymous sign-in must be enabled under **Firebase console → Authentication → Sign-in method**.

## FAQ

**A solve didn't register.** LeetX listens for LeetCode's "Accepted" result after you press **Submit** (or Ctrl/⌘+Enter) on a problem page. Make sure you're signed in to leetcode.com. Running **Sync now** in Settings catches anything that was missed.

**Does my streak match LeetCode's?** On first run LeetX imports your LeetCode activity calendar, then counts a day as soon as you get an accepted submission. Days follow your local time zone.

**I removed someone by mistake.** Removed members can't rejoin until the leader opens the squad menu (⋯) and picks **Let removed members rejoin**.
