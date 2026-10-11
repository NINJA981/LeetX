import { DAY_MS } from '../../scripts/core.js';
import { button, h, icon, iconButton, mount, openExternal, problemUrl, progressBar, segmented, toast } from '../ui.js';

const ROADMAPS = [
  { value: 'blind75', label: 'Blind 75' },
  { value: 'neetcode150', label: 'NeetCode 150' },
];
const REVIEW_OPTIONS = [
  { days: 1, label: 'Tomorrow' },
  { days: 3, label: '3 days' },
  { days: 7, label: '1 week' },
  { days: 14, label: '2 weeks' },
  { days: 30, label: '1 month' },
];

let query = '';

export async function renderRoadmap(ctx) {
  const data = ctx.store.data;
  const type = data.roadmap_type === 'neetcode150' ? 'neetcode150' : 'blind75';
  const list = (await ctx.getRoadmaps())[type];
  const solved = new Set(data.user_solved_slugs || []);
  const categories = [...new Set(list.map(p => p.category))];
  const category = categories.includes(data.roadmap_category) ? data.roadmap_category : 'all';
  const solvedCount = list.filter(p => solved.has(p.slug)).length;

  const listHost = h('div');
  const paintList = () => mount(listHost, problemList(ctx, list, solved, category));

  const search = h('input.input.input-search', {
    type: 'search',
    placeholder: `Search ${list.length} problems`,
    value: query,
    'aria-label': 'Search problems',
    oninput: e => { query = e.target.value; paintList(); },
  });

  const view = h('div.stack',
    h('div.roadmap-head',
      segmented(ROADMAPS, type, async v => { await ctx.set({ roadmap_type: v, roadmap_category: 'all' }); ctx.rerender(); }, { label: 'Roadmap' }),
      h('span.roadmap-count', h('strong', String(solvedCount)), `/${list.length}`),
    ),
    progressBar(solvedCount / list.length, { tone: 'success', label: 'Roadmap progress' }),
    h('label.search', icon('search', { size: 14 }), search),
    h('div.chips', { role: 'tablist', 'aria-label': 'Topics' },
      chip('All', 'all', category, list.length, solvedCount, ctx),
      categories.map(c => {
        const inCat = list.filter(p => p.category === c);
        return chip(c, c, category, inCat.length, inCat.filter(p => solved.has(p.slug)).length, ctx);
      }),
    ),
    listHost,
  );
  paintList();
  requestAnimationFrame(() => view.querySelector('.chip.is-active')?.scrollIntoView({ block: 'nearest', inline: 'center' }));
  return view;
}

function chip(label, value, active, total, done, ctx) {
  const isActive = value === active;
  return h(`button.chip-filter${isActive ? '.is-active' : ''}${done === total && total ? '.is-complete' : ''}`, {
    type: 'button',
    role: 'tab',
    'aria-selected': String(isActive),
    class: 'chip',
    onclick: async () => { await ctx.set({ roadmap_category: value }); ctx.rerender(); },
  }, h('span', label), h('span.chip-count', `${done}/${total}`));
}

function problemList(ctx, list, solved, category) {
  const q = query.trim().toLowerCase();
  const filtered = list.filter(p =>
    (category === 'all' || p.category === category)
    && (!q || p.title.toLowerCase().includes(q) || String(p.id) === q));

  if (!filtered.length) return h('p.muted.pad', `No problems match "${query}".`);

  const next = filtered.find(p => !solved.has(p.slug));
  const groups = new Map();
  for (const p of filtered) {
    if (!groups.has(p.category)) groups.set(p.category, []);
    groups.get(p.category).push(p);
  }

  const schedule = ctx.store.data.review_schedule || {};
  const showHeaders = category === 'all' && !q;
  return h('div.problem-groups', [...groups.entries()].map(([cat, items]) => h('section.problem-group',
    showHeaders ? h('h3.group-title', h('span', cat), h('span.group-count', `${items.filter(p => solved.has(p.slug)).length}/${items.length}`)) : null,
    h('ul.problems', items.map(p => problemRow(ctx, p, solved.has(p.slug), p === next, schedule[p.slug]))),
  )));
}

function problemRow(ctx, p, isSolved, isNext, review) {
  const hasNotes = Boolean(ctx.store.data[`notes_${p.slug}`]);
  return h(`li.problem${isSolved ? '.is-solved' : ''}${isNext ? '.is-next' : ''}`,
    h('button.problem-main', { type: 'button', onclick: () => openSheet(ctx, p, isSolved), 'aria-label': `${p.title}, ${p.difficulty}${isSolved ? ', solved' : ''}` },
      h('span.status', isSolved ? icon('check', { size: 11 }) : null),
      h('span.problem-title', p.title),
      isNext ? h('span.next-tag', 'Next') : null,
      hasNotes ? h('span.problem-flag', { title: 'Has notes' }, icon('pencil', { size: 11 })) : null,
      review ? h('span.problem-flag', { title: 'Review scheduled' }, icon('rotate', { size: 11 })) : null,
      h(`span.diff-letter.diff-${p.difficulty.toLowerCase()}`, { title: p.difficulty }, p.difficulty[0]),
    ),
    iconButton('external', `Open ${p.title} on LeetCode`, { class: 'problem-open', onclick: () => openExternal(problemUrl(p.slug)) }),
  );
}

// ---------------------------------------------------------------------------
// Problem sheet: notes + spaced review
// ---------------------------------------------------------------------------

function openSheet(ctx, p, isSolved) {
  const notesKey = `notes_${p.slug}`;
  const saved = h('span.save-state', '');
  let saveTimer = null;
  const textarea = h('textarea.input.notes', {
    rows: 6,
    placeholder: 'Key insight, complexity, the bug that got you…',
    'aria-label': 'Notes',
    oninput: e => {
      saved.textContent = 'Saving…';
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        const value = e.target.value;
        if (value.trim()) await ctx.set({ [notesKey]: value });
        else { delete ctx.store.data[notesKey]; await chrome.storage.local.remove(notesKey); }
        saved.textContent = 'Saved';
      }, 400);
    },
  });
  textarea.value = ctx.store.data[notesKey] || '';

  const reviewHost = h('div');
  const paintReview = () => {
    const current = (ctx.store.data.review_schedule || {})[p.slug];
    mount(reviewHost,
      current
        ? h('div.review-set',
          icon('calendar', { size: 14 }),
          h('span', `Review on ${new Date(current.dueDate).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`),
          button('Clear', { size: 'sm', variant: 'ghost', onclick: () => setReview(null) }),
        )
        : h('div.review-options', REVIEW_OPTIONS.map(o => button(o.label, { size: 'sm', onclick: () => setReview(o.days) }))),
    );
  };
  const setReview = async days => {
    const schedule = { ...(ctx.store.data.review_schedule || {}) };
    if (days === null) delete schedule[p.slug];
    else {
      const due = new Date(Date.now() + days * DAY_MS);
      due.setHours(0, 0, 0, 0);
      schedule[p.slug] = { id: p.id, title: p.title, dueDate: due.getTime() };
    }
    await ctx.set({ review_schedule: schedule });
    paintReview();
    if (days) toast(`It'll show up in Today when it's due`, { tone: 'success' });
  };
  paintReview();

  const backdrop = h('div.sheet-backdrop');
  const close = () => {
    clearTimeout(saveTimer);
    if (textarea.value !== (ctx.store.data[notesKey] || '')) {
      const value = textarea.value;
      if (value.trim()) ctx.set({ [notesKey]: value });
    }
    sheet.classList.remove('in');
    backdrop.classList.remove('in');
    setTimeout(() => { backdrop.remove(); ctx.rerender(); }, 180);
  };
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  backdrop.addEventListener('close', close);

  const sheet = h('div.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': p.title },
    h('div.sheet-grip'),
    h('div.sheet-head',
      h('div',
        h('div.eyebrow', `#${p.id}`, h('span.eyebrow-sep', '·'), p.category),
        h('h2.sheet-title', p.title),
        h('div.sheet-meta',
          h(`span.diff.diff-${p.difficulty.toLowerCase()}`, p.difficulty),
          isSolved ? h('span.solved-pill', icon('check', { size: 12 }), 'Solved') : h('span.muted', 'Not solved yet'),
        ),
      ),
      iconButton('x', 'Close', { onclick: close }),
    ),
    h('div.field',
      h('div.field-row', h('span.field-label', 'Notes'), saved),
      textarea,
      ctx.store.data.github_token ? h('span.field-hint', 'Committed to GitHub as Notes.md with your next solve or sync.') : null,
    ),
    h('div.field', h('span.field-label', 'Review again'), reviewHost),
    button(isSolved ? 'Solve again on LeetCode' : 'Solve on LeetCode', { variant: 'primary', class: 'btn-block', iconRight: 'external', onclick: () => openExternal(problemUrl(p.slug)) }),
  );
  backdrop.appendChild(sheet);
  document.getElementById('app').appendChild(backdrop);
  requestAnimationFrame(() => { backdrop.classList.add('in'); sheet.classList.add('in'); });
  setTimeout(() => textarea.focus({ preventScroll: true }), 200);
}
