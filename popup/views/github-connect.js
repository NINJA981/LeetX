import { GitHubAPI } from '../../scripts/github.js';
import { busy, button, h, icon, toggle } from '../ui.js';

const TOKEN_URL = 'https://github.com/settings/tokens/new?description=LeetX%20Squads&scopes=repo';
const AUTH_BROKER = 'https://leetx-auth.sistmate-static.workers.dev';

/** One-click GitHub sign-in: the broker holds the OAuth client secret and hands the token back in the redirect fragment. */
async function signInWithGitHub() {
  const redirect = chrome.identity.getRedirectURL('github');
  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: `${AUTH_BROKER}/login?redirect=${encodeURIComponent(redirect)}`,
    interactive: true,
  });
  const params = new URLSearchParams(new URL(responseUrl).hash.slice(1));
  if (params.get('error')) {
    throw new Error(params.get('error') === 'access_denied' ? 'GitHub sign-in was cancelled.' : 'GitHub sign-in failed. Try again.');
  }
  const token = params.get('access_token');
  if (!token) throw new Error('GitHub sign-in failed. Try again.');
  return token;
}

/** Shared GitHub connection form (onboarding + settings). */
export function githubConnectForm(ctx, { onConnected, compact = false } = {}) {
  let isPrivate = ctx.store.data.github_repo_private !== false;
  const error = h('p.form-error', { role: 'alert' });

  const token = h('input.input', {
    type: 'password',
    placeholder: 'ghp_… or github_pat_…',
    autocomplete: 'off',
    spellcheck: false,
    'aria-label': 'GitHub token',
    onkeydown: e => { if (e.key === 'Enter') submit.click(); },
  });
  const repo = h('input.input', {
    type: 'text',
    value: ctx.store.data.github_repo_name || 'leetcode-submissions',
    spellcheck: false,
    'aria-label': 'Repository name',
  });

  async function connect(value) {
    const repoName = repo.value.trim().replace(/[^A-Za-z0-9._-]/g, '-') || 'leetcode-submissions';
    try {
      const api = new GitHubAPI(value);
      const { owner, created } = await api.ensureRepository(repoName, { isPrivate });
      const updates = {
        github_token: value,
        github_repo_owner: owner,
        github_repo_name: repoName,
        github_repo_private: isPrivate,
        github_last_error: null,
      };
      if (!ctx.store.data.display_name) updates.display_name = owner;
      await ctx.set(updates);
      await ctx.sendMessage({ type: 'START_FULL_SYNC' });
      onConnected?.({ owner, repoName, created });
    } catch (err) {
      error.textContent = err.status === 401
        ? 'GitHub rejected this token. Make sure it has the "repo" scope and has not expired.'
        : err.status === 403
          ? 'This token cannot create or write to repositories. Give it the "repo" scope (or Contents + Administration write for fine-grained tokens).'
          : err.message || 'Could not reach GitHub.';
    }
  }

  const signIn = button('Connect with GitHub', {
    variant: 'primary',
    class: 'btn-block',
    iconName: 'github',
    onclick: busy(async () => {
      error.textContent = '';
      let value;
      try {
        value = await signInWithGitHub();
      } catch (err) {
        // Closing the sign-in window is not an error worth shouting about.
        error.textContent = /did not approve|closed|cancel/i.test(err.message || '') ? 'GitHub sign-in was cancelled.' : err.message || 'GitHub sign-in failed. Try again.';
        return;
      }
      await connect(value);
    }),
  });

  const submit = button('Connect with token', {
    variant: 'secondary',
    class: 'btn-block',
    onclick: busy(async () => {
      error.textContent = '';
      const value = token.value.trim();
      if (!/^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$/.test(value)) {
        error.textContent = "That doesn't look like a GitHub token. Copy the whole token from GitHub.";
        token.focus();
        return;
      }
      await connect(value);
    }),
  });

  return h('div.connect-form',
    compact ? null : h('div.field',
      h('span.field-label', 'Repository'),
      repo,
    ),
    h('div.setting-row',
      h('div.setting-text', h('span.setting-title', icon('lock', { size: 13 }), 'Private repository'), h('span.setting-sub', 'Only you can see your solutions')),
      toggle(isPrivate, v => { isPrivate = v; }, 'Private repository'),
    ),
    error,
    signIn,
    h('p.fine-print', 'Opens GitHub to approve access. LeetX creates the repository for you and only talks to api.github.com.'),
    h('details.advanced',
      h('summary', 'Use a personal access token instead'),
      h('div.step-body', 'Create a token with the "repo" scope, then paste it here.'),
      button('Open GitHub', { size: 'sm', iconRight: 'external', onclick: () => chrome.tabs.create({ url: TOKEN_URL }) }),
      token,
      submit,
    ),
  );
}
