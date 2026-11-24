import { buildBackup, parseBackup, sanitizeName } from '../../scripts/core.js';
import { Squads } from '../../scripts/firebase.js';
import { getProfile } from '../../scripts/state.js';
import { applyTheme } from '../theme.js';
import {
  busy, button, confirmButton, confirmDialog, h, icon, iconButton, openExternal, segmented, toast, toggle,
} from '../ui.js';
import { githubConnectForm } from './github-connect.js';

const THEME_OPTIONS = [
  { value: 'system', label: 'Auto', icon: 'monitor' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'neon', label: 'Neon', icon: 'sparkles' },
];
const GOAL_OPTIONS = [1, 2, 3, 5].map(n => ({ value: n, label: String(n) }));
const REMINDER_HOURS = [17, 18, 19, 20, 21, 22];

export async function renderSettings(ctx) {
  const data = ctx.store.data;
  const save = (key, toastText) => async value => {
    await ctx.set({ [key]: value });
    if (toastText) toast(typeof toastText === 'function' ? toastText(value) : toastText);
  };

  return h('div.settings',
    h('div.settings-top',
      iconButton('chevronLeft', 'Back', { onclick: () => ctx.navigate('today') }),
      h('h1.settings-title', 'Settings'),
    ),

    group('Profile',
      field('Display name', 'Shown to your squad',
        textInput(data.display_name || data.github_repo_owner || '', 'Your name', async value => {
          const name = sanitizeName(value, '');
          if (!name) return;
          await ctx.set({ display_name: name });
          if (data.my_squad_code) await Squads.updateMyStats(data.my_squad_code, await getProfile()).catch(() => {});
          toast('Name updated', { tone: 'success' });
        })),
      field('LeetCode username', 'Detected from your leetcode.com session',
        textInput(data.leetcode_username || '', 'username', async value => {
          const clean = value.trim().replace(/[^A-Za-z0-9_-]/g, '');
          if (!clean) return;
          await ctx.set({ leetcode_username: clean, history_seeded: false });
          await ctx.sendMessage({ type: 'REFRESH_STATE' });
          toast('Stats refreshed', { tone: 'success' });
        })),
    ),

    group('Daily habit',
      row('Daily goal', 'Problems per day to close your ring',
        segmented(GOAL_OPTIONS, Number(data.daily_goal) || 1, async v => { await save('daily_goal')(v); ctx.rerender(); }, { label: 'Daily goal', size: 'sm' })),
      row('Evening reminder', "Only if you haven't solved yet that day",
        toggle(data.reminder_enabled !== false, async v => { await save('reminder_enabled')(v); ctx.rerender(); }, 'Evening reminder')),
      row('Auto-schedule reviews', 'New Medium and Hard solves come back for review in 3 days',
        toggle(data.auto_review_enabled !== false, save('auto_review_enabled'), 'Auto-schedule reviews')),
      data.reminder_enabled !== false
        ? row('Remind me at', null, h('select.select', {
          'aria-label': 'Reminder time',
          onchange: e => save('reminder_hour', v => `Reminder set for ${formatHour(v)}`)(Number(e.target.value)),
        }, REMINDER_HOURS.map(hr => h('option', { value: hr, selected: hr === (data.reminder_hour ?? 20) }, formatHour(hr)))))
        : null,
    ),

    group('Notifications',
      row('Desktop notifications', 'Duels, nudges, reminders and sync',
        toggle(data.notifications_enabled !== false, save('notifications_enabled'), 'Desktop notifications')),
      row('Squad solves', 'When a squadmate solves a problem',
        toggle(data.notify_squad_solves_enabled !== false, save('notify_squad_solves_enabled'), 'Squad solve notifications')),
      row('Share my solves', 'Post your accepted solves to your squad',
        toggle(data.share_solves_enabled !== false, save('share_solves_enabled'), 'Share my solves')),
      row('Contest reminders', 'About 30 minutes before each LeetCode contest',
        toggle(data.contest_reminders_enabled !== false, save('contest_reminders_enabled'), 'Contest reminders')),
      row('Weekly recap', 'Sunday evening summary of your week',
        toggle(data.weekly_recap_enabled !== false, save('weekly_recap_enabled'), 'Weekly recap')),
      row('Test', null, button('Send test', {
        size: 'sm',
        iconName: 'bell',
        onclick: busy(async () => { await ctx.sendMessage({ type: 'TEST_NOTIFICATION' }); }),
      })),
    ),

    group('On LeetCode',
      row('Companion pill', 'Streak, solve timer and notes on problem pages',
        toggle(data.companion_enabled !== false, save('companion_enabled', v => v ? 'Companion on. Reload LeetCode to see it.' : 'Companion hidden'), 'Companion pill')),
    ),

    githubGroup(ctx, data),

    group('Appearance',
      h('div.setting-row.stacked',
        segmented(THEME_OPTIONS, data.theme_preference || 'system', async v => {
          applyTheme(v);
          await ctx.set({ theme_preference: v });
          ctx.rerender();
        }, { label: 'Theme' }),
      ),
    ),

    group('Backup',
      row('Export backup', 'Saves your progress, notes and squad identity to a file. Keep it private. It does not include your GitHub token.',
        button('Export', { size: 'sm', onclick: busy(exportBackup) })),
      row('Import backup', 'Restores a backup file on this device, replacing matching data. Opens in a tab so the file picker works.',
        button('Import', { size: 'sm', onclick: () => importBackup(ctx) })),
    ),

    group('Data',
      row('Reset local progress', 'Clears streak history, XP and duel record on this device',
        confirmButton('Reset', 'Tap to confirm', async () => {
          await chrome.storage.local.remove(['solve_history', 'user_xp', 'duel_history', 'xp_awarded_ids', 'streak_seen', 'processed_submissions', 'frozen_days', 'solve_times', 'achievements', 'reviews_done', 'freezes_used', 'fast_medium_solves', 'night_solves']);
          await ctx.set({ history_seeded: true });
          toast('Progress reset');
          ctx.rerender();
        })),
    ),

    h('footer.about',
      h('div', `LeetX Squads ${chrome.runtime.getManifest().version}`),
      h('p.shortcuts', 'Shortcuts: ', h('kbd', '1'), '–', h('kbd', '4'), ' tabs · ', h('kbd', '/'), ' search roadmap · ', h('kbd', ','), ' settings'),
      h('p', 'Your code goes only to your own GitHub repository. Squads see your display name, streak, solve counts and the titles of problems you solve.'),
      h('button.link-btn', { type: 'button', onclick: () => openExternal('https://github.com/NINJA981/LeetX') }, 'Source & feedback', icon('external', { size: 12 })),
    ),
  );
}

function githubGroup(ctx, data) {
  if (!data.github_token) {
    return group('GitHub backup', h('div.pad-sm', githubConnectForm(ctx, {
      onConnected: ({ owner, repoName, created }) => {
        toast(created ? `Created ${owner}/${repoName}. Syncing your solutions…` : `Connected ${owner}/${repoName}. Syncing…`, { tone: 'success' });
        ctx.rerender();
      },
    })));
  }

  const repo = `${data.github_repo_owner}/${data.github_repo_name || 'leetcode-submissions'}`;
  const status = data.sync_status || {};
  const syncing = status.state === 'syncing' && Date.now() - (status.updatedAt || 0) < 120000;
  return group('GitHub backup',
    row(repo, data.github_repo_private === false ? 'Public repository' : 'Private repository',
      iconButton('external', 'Open repository', { onclick: () => openExternal(`https://github.com/${repo}`) })),
    row('Sync everything', syncing ? status.message : status.state === 'error' ? status.message : 'Commit any solved problem missing from the repo',
      button(syncing ? 'Syncing…' : 'Sync now', {
        size: 'sm',
        iconName: 'refresh',
        disabled: syncing,
        onclick: busy(async () => {
          await ctx.sendMessage({ type: 'START_FULL_SYNC' });
          toast('Sync started');
        }),
      })),
    row('Disconnect', 'Removes the token from this browser. Your repository is untouched.',
      confirmButton('Disconnect', 'Confirm', async () => {
        await chrome.storage.local.remove(['github_token', 'github_repo_owner', 'sync_status', 'github_last_error', 'github_last_commit']);
        toast('GitHub disconnected');
        ctx.rerender();
      })),
  );
}

// ---------------------------------------------------------------------------

function group(title, ...rows) {
  return h('section.group', h('h2.group-label', title), h('div.group-body', rows));
}

function row(title, sub, control) {
  return h('div.setting-row',
    h('div.setting-text', h('span.setting-title', title), sub ? h('span.setting-sub', sub) : null),
    control,
  );
}

function field(title, sub, control) {
  return h('label.setting-row.stacked',
    h('div.setting-text', h('span.setting-title', title), sub ? h('span.setting-sub', sub) : null),
    control,
  );
}

function textInput(value, placeholder, onCommit) {
  let committed = value;
  const input = h('input.input', { type: 'text', value, placeholder, maxLength: 40, spellcheck: false });
  const commit = () => {
    if (input.value.trim() === committed.trim()) return;
    committed = input.value;
    onCommit(input.value);
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  return input;
}

function formatHour(hour) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Backup & restore
// ---------------------------------------------------------------------------

async function exportBackup() {
  const backup = buildBackup(await chrome.storage.local.get(null), { version: chrome.runtime.getManifest().version });
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `leetx-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast('Backup saved to your downloads', { tone: 'success' });
}

function importBackup(ctx) {
  // A file picker can close the toolbar popup before a file is chosen, so do the import from a full tab.
  if (!new URLSearchParams(location.search).has('tab')) {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/index.html?tab=1') });
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const { data, exportedAt } = parseBackup(await file.text());
      const when = exportedAt ? ` from ${exportedAt.slice(0, 10)}` : '';
      const ok = await confirmDialog({
        title: 'Restore this backup?',
        body: `This replaces matching progress on this device with the backup${when}. Reconnect GitHub afterwards.`,
        confirmLabel: 'Restore',
      });
      if (!ok) return;
      await chrome.storage.local.set(data);
      toast('Backup restored', { tone: 'success' });
      ctx.rerender();
    } catch (err) {
      toast(err.message || 'Could not read that backup.', { tone: 'error' });
    }
  });
  input.click();
}
