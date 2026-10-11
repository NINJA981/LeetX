/**
 * LeetX Squads - leetcode.com content script.
 * Detects accepted submissions and shows LeetX feedback. All UI lives in a
 * closed shadow root and is built with textContent only - no remote string is
 * ever parsed as HTML on the page.
 */
(() => {
  'use strict';
  if (window.__LEETX_CONTENT__) return;
  window.__LEETX_CONTENT__ = true;

  const alive = () => {
    try { return Boolean(chrome?.runtime?.id); } catch { return false; }
  };

  // ---------------------------------------------------------------------------
  // Shadow-DOM host
  // ---------------------------------------------------------------------------

  let root = null;
  function getRoot() {
    if (root?.host.isConnected) return root;
    const host = document.createElement('leetx-overlay');
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483646; inset: 0; pointer-events: none;';
    document.documentElement.appendChild(host);
    root = host.attachShadow({ mode: 'closed' });
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('styles/content.css');
    root.appendChild(link);
    const stack = document.createElement('div');
    stack.className = 'stack';
    root.appendChild(stack);
    return root;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    check: ['M20 6 9 17l-5-5'],
    flame: ['M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z'],
    bolt: ['M13 2 3 14h9l-1 8 10-12h-9l1-8z'],
    bell: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'],
    x: ['M18 6 6 18', 'm6 6 12 12'],
    clock: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M12 6v6l4 2'],
    pencil: ['M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z', 'm15 5 4 4'],
    snowflake: ['M2 12h20', 'M12 2v20', 'm20 16-4-4 4-4', 'm4 8 4 4-4 4', 'm16 4-4 4-4-4', 'm8 20 4-4 4 4'],
    rotate: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
    trophy: ['M6 9H4.5a2.5 2.5 0 0 1 0-5H6', 'M18 9h1.5a2.5 2.5 0 0 0 0-5H18', 'M4 22h16', 'M18 2H6v7a6 6 0 0 0 12 0V2Z'],
  };
  const fmtClock = sec => {
    const s = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}`;
  };
  function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of ICONS[name]) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    }
    return svg;
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function present(card, ttl) {
    const stack = getRoot().querySelector('.stack');
    while (stack.children.length >= 3) stack.firstElementChild.remove();
    stack.appendChild(card);
    requestAnimationFrame(() => card.classList.add('in'));
    const dismiss = () => {
      card.classList.remove('in');
      card.classList.add('out');
      setTimeout(() => card.remove(), 220);
    };
    card.querySelector('.close')?.addEventListener('click', dismiss);
    let timer = setTimeout(dismiss, ttl);
    card.addEventListener('mouseenter', () => clearTimeout(timer));
    card.addEventListener('mouseleave', () => { timer = setTimeout(dismiss, 2500); });
  }

  function closeButton() {
    const btn = el('button', 'close');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Dismiss');
    btn.appendChild(icon('x'));
    return btn;
  }

  // ---------------------------------------------------------------------------
  // Toasts
  // ---------------------------------------------------------------------------

  function showSolveToast(res) {
    const card = el('section', `card solve${res.milestone ? ' milestone' : ''}`);
    card.setAttribute('role', 'status');

    const head = el('div', 'head');
    const badge = el('span', 'badge ok');
    badge.appendChild(icon('check'));
    head.appendChild(badge);
    const titles = el('div', 'titles');
    titles.appendChild(el('div', 'eyebrow', res.milestone ? `${res.milestone}-day streak` : 'Accepted'));
    titles.appendChild(el('div', 'title', res.problem?.title || 'Problem solved'));
    head.appendChild(titles);
    head.appendChild(closeButton());
    card.appendChild(head);

    const stats = el('div', 'stats');
    const streak = el('div', 'stat');
    const flame = el('span', `ico ${res.streakExtended ? 'hot' : ''}`);
    flame.appendChild(icon('flame'));
    streak.appendChild(flame);
    streak.appendChild(el('span', 'num', res.streak));
    streak.appendChild(el('span', 'lbl', 'day streak'));
    stats.appendChild(streak);

    const xp = el('div', 'stat');
    const bolt = el('span', 'ico');
    bolt.appendChild(icon('bolt'));
    xp.appendChild(bolt);
    xp.appendChild(el('span', 'num', `+${res.xpEarned || 0}`));
    xp.appendChild(el('span', 'lbl', 'XP'));
    stats.appendChild(xp);

    if (res.solveSeconds) {
      const time = el('div', 'stat');
      const clock = el('span', `ico ${res.isNewBest ? 'best' : ''}`);
      clock.appendChild(icon('clock'));
      time.appendChild(clock);
      time.appendChild(el('span', 'num', fmtClock(res.solveSeconds)));
      time.appendChild(el('span', 'lbl', res.isNewBest ? 'new best' : 'time'));
      stats.appendChild(time);
    }
    card.appendChild(stats);

    const metrics = [];
    if (res.runtimeDisplay) metrics.push(`${res.runtimeDisplay}${res.runtimePercentile != null ? ` · beats ${Number(res.runtimePercentile).toFixed(0)}%` : ''}`);
    if (res.memoryDisplay) metrics.push(res.memoryDisplay);
    if (metrics.length) card.appendChild(el('div', 'meta', metrics.join('   ·   ')));
    if (res.leveledUp) card.appendChild(el('div', 'meta accent', `Level ${res.level} reached`));
    else if (res.streakExtended && !res.milestone) card.appendChild(el('div', 'meta', 'Streak extended. Done for today.'));
    if (res.freezeEarned) card.appendChild(metaWithIcon('snowflake', `Streak freeze earned · ${res.freezes} ready`, 'ice'));
    if (res.review?.done) card.appendChild(metaWithIcon('rotate', res.review.nextInDays ? `Review done · next in ${res.review.nextInDays} days` : 'Review done · you know this one now'));
    else if (res.review?.scheduledInDays) card.appendChild(metaWithIcon('rotate', `Review scheduled in ${res.review.scheduledInDays} days`));
    for (const a of res.achievements || []) card.appendChild(metaWithIcon('trophy', `Achievement: ${a.title}`, 'gold'));
    if (!res.isNewProblem && !res.review?.done) card.appendChild(el('div', 'meta', 'Solved before, so practice XP only.'));

    present(card, res.milestone || res.achievements?.length ? 9000 : 6500);
    if (res.milestone || res.leveledUp || res.achievements?.length) burst(70);
    else if (res.streakExtended) burst(28);
  }

  function metaWithIcon(name, text, tone = '') {
    const row = el('div', `meta with-icon ${tone}`.trim());
    row.appendChild(icon(name));
    row.appendChild(el('span', null, text));
    return row;
  }

  function showAlert(title, message) {
    const card = el('section', 'card alert');
    card.setAttribute('role', 'status');
    const head = el('div', 'head');
    const badge = el('span', 'badge');
    badge.appendChild(icon('bell'));
    head.appendChild(badge);
    const titles = el('div', 'titles');
    titles.appendChild(el('div', 'title', title || 'LeetX'));
    if (message) titles.appendChild(el('div', 'body', message));
    head.appendChild(titles);
    head.appendChild(closeButton());
    card.appendChild(head);
    present(card, 6000);
  }

  // ---------------------------------------------------------------------------
  // Confetti (canvas, respects reduced motion)
  // ---------------------------------------------------------------------------

  function burst(count) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483645';
    document.documentElement.appendChild(canvas);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const colors = ['#F43F5E', '#F59E0B', '#22C55E', '#38BDF8', '#E5E7EB'];
    const originX = innerWidth - 180;
    const originY = innerHeight - 120;
    const parts = Array.from({ length: count }, () => ({
      x: originX, y: originY,
      vx: (Math.random() - 0.7) * 11, vy: -Math.random() * 13 - 4,
      s: Math.random() * 5 + 3, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      c: colors[(Math.random() * colors.length) | 0], a: 1,
    }));
    const frame = () => {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      let any = false;
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.42; p.vx *= 0.99; p.r += p.vr; p.a -= 0.014;
        if (p.a <= 0) continue;
        any = true;
        ctx.save();
        ctx.globalAlpha = p.a;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      }
      if (any) requestAnimationFrame(frame);
      else canvas.remove();
    };
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------------
  // On-page companion: streak, active-time solve timer, context and notes
  // ---------------------------------------------------------------------------

  const companion = { slug: null, node: null, seconds: 0, ctx: null, notesOpen: false, hidden: false };
  const timerKey = slug => `leetx_timer_${slug}`;

  function loadAttemptTimer(slug) {
    try { return Number(sessionStorage.getItem(timerKey(slug))) || 0; } catch { return 0; }
  }
  function saveAttemptTimer() {
    if (!companion.slug) return;
    try { sessionStorage.setItem(timerKey(companion.slug), String(companion.seconds)); } catch { /* storage blocked */ }
  }
  function resetAttemptTimer(slug) {
    if (companion.slug !== slug) return;
    companion.seconds = 0;
    saveAttemptTimer();
    paintTimer();
  }

  setInterval(() => {
    if (!alive()) return;
    const slug = currentSlug();
    if (slug !== companion.slug) {
      saveAttemptTimer();
      companion.slug = slug;
      companion.seconds = slug ? loadAttemptTimer(slug) : 0;
      companion.notesOpen = false;
      if (slug) refreshCompanion(); else removeCompanion();
      return;
    }
    // Only time you actually spend looking at the problem counts.
    if (slug && document.visibilityState === 'visible') {
      companion.seconds += 1;
      if (companion.seconds % 5 === 0) saveAttemptTimer();
      paintTimer();
    }
  }, 1000);
  window.addEventListener('pagehide', saveAttemptTimer);

  function removeCompanion() {
    companion.node?.remove();
    companion.node = null;
  }

  function paintTimer() {
    const t = companion.node?.querySelector('.cmp-time');
    if (t) t.textContent = fmtClock(companion.seconds);
  }

  function refreshCompanion() {
    const slug = companion.slug;
    if (!slug || companion.hidden || !alive()) return;
    try {
      chrome.runtime.sendMessage({ type: 'GET_PROBLEM_CONTEXT', slug }, ctx => {
        if (chrome.runtime.lastError || !ctx?.success || slug !== companion.slug) return;
        companion.ctx = ctx;
        if (!ctx.enabled) { removeCompanion(); return; }
        renderCompanion();
      });
    } catch { /* extension reloaded */ }
  }

  function stop(e) { e.stopPropagation(); }

  function renderCompanion() {
    const { ctx } = companion;
    const root = getRoot();
    removeCompanion();

    const wrap = el('div', 'companion');
    // Keep LeetCode's global keyboard shortcuts from reacting to typing in our UI.
    for (const type of ['keydown', 'keyup', 'keypress']) wrap.addEventListener(type, stop);

    if (companion.notesOpen) wrap.appendChild(notesPanel(ctx));

    const pill = el('div', 'pill');
    pill.setAttribute('role', 'toolbar');
    pill.setAttribute('aria-label', 'LeetX');

    const streak = el('span', `pill-item streak ${ctx.solvedToday ? 'hot' : ''}`);
    streak.title = ctx.solvedToday ? `${ctx.streak}-day streak, done for today` : `${ctx.streak}-day streak, solve one today`;
    streak.appendChild(icon('flame'));
    streak.appendChild(el('span', null, ctx.streak));
    pill.appendChild(streak);

    const time = el('span', 'pill-item');
    time.title = ctx.bestSeconds ? `Time on this problem · your best is ${fmtClock(ctx.bestSeconds)}` : 'Time on this problem (only while the tab is visible)';
    time.appendChild(icon('clock'));
    time.appendChild(el('span', 'cmp-time', fmtClock(companion.seconds)));
    pill.appendChild(time);

    if (ctx.reviewDue) {
      const due = el('span', 'pill-item review');
      due.title = 'Review due: solving this counts as your review';
      due.appendChild(icon('rotate'));
      due.appendChild(el('span', null, 'Review'));
      pill.appendChild(due);
    }

    const notesBtn = el('button', `pill-btn ${companion.notesOpen ? 'is-on' : ''}`);
    notesBtn.type = 'button';
    notesBtn.setAttribute('aria-label', companion.notesOpen ? 'Close notes' : 'Notes');
    notesBtn.setAttribute('aria-expanded', String(companion.notesOpen));
    notesBtn.title = 'Notes for this problem';
    notesBtn.appendChild(icon('pencil'));
    notesBtn.addEventListener('click', () => { companion.notesOpen = !companion.notesOpen; renderCompanion(); });
    pill.appendChild(notesBtn);

    const hide = el('button', 'pill-btn');
    hide.type = 'button';
    hide.setAttribute('aria-label', 'Hide LeetX on this page');
    hide.title = 'Hide until reload (turn off in LeetX settings)';
    hide.appendChild(icon('x'));
    hide.addEventListener('click', () => { companion.hidden = true; removeCompanion(); });
    pill.appendChild(hide);

    wrap.appendChild(pill);
    root.appendChild(wrap);
    companion.node = wrap;
    if (companion.notesOpen) wrap.querySelector('textarea')?.focus();
  }

  function notesPanel(ctx) {
    const panel = el('div', 'notes-panel');
    const chips = el('div', 'chips');
    for (const l of ctx.lists) chips.appendChild(el('span', 'chip', `${l.label} · ${l.category}`));
    if (ctx.solvedBefore) chips.appendChild(el('span', 'chip ok', 'Solved before'));
    if (ctx.bestSeconds) chips.appendChild(el('span', 'chip', `Best ${fmtClock(ctx.bestSeconds)}`));
    if (chips.children.length) panel.appendChild(chips);

    const head = el('div', 'notes-head');
    head.appendChild(el('span', 'notes-title', 'Notes'));
    const state = el('span', 'notes-state', '');
    head.appendChild(state);
    panel.appendChild(head);

    const key = `notes_${companion.slug}`;
    const area = document.createElement('textarea');
    area.className = 'notes-input';
    area.rows = 6;
    area.placeholder = 'Approach, complexity, the edge case that bit you…';
    area.setAttribute('aria-label', 'Notes for this problem');
    chrome.storage.local.get(key).then(d => { area.value = d[key] || ''; });
    let timer = null;
    area.addEventListener('input', () => {
      state.textContent = 'Saving…';
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (!alive()) return;
        if (area.value.trim()) await chrome.storage.local.set({ [key]: area.value });
        else await chrome.storage.local.remove(key);
        state.textContent = 'Saved';
      }, 400);
    });
    panel.appendChild(area);
    panel.appendChild(el('div', 'notes-hint', 'Synced to GitHub as Notes.md with your next accepted solve.'));
    return panel;
  }

  // ---------------------------------------------------------------------------
  // Submission detection
  // ---------------------------------------------------------------------------

  let watching = false;
  let watchStarted = 0;
  let pollTimer = null;
  const reported = new Set();

  const currentSlug = () => location.pathname.match(/\/problems\/([a-z0-9-]+)/i)?.[1]?.toLowerCase() || null;

  function startWatching() {
    watching = true;
    watchStarted = Date.now();
    clearInterval(pollTimer);
    pollTimer = setInterval(checkResult, 500);
  }

  function stopWatching() {
    watching = false;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function difficultyFromPage() {
    const node = document.querySelector('[class*="text-difficulty-"], [class*="text-sd-easy"], [class*="text-sd-medium"], [class*="text-sd-hard"]');
    const text = node?.textContent || '';
    if (/easy/i.test(text)) return 'Easy';
    if (/hard/i.test(text)) return 'Hard';
    return 'Medium';
  }

  function metricsFromPage(container) {
    const text = container?.innerText || '';
    const num = re => text.match(re)?.[1] ?? null;
    return {
      runtimeDisplay: num(/Runtime[\s\S]{0,40}?(\d+(?:\.\d+)?\s*ms)/i),
      runtimePercentile: num(/Runtime[\s\S]{0,80}?Beats\s*(\d+(?:\.\d+)?)\s*%/i),
      memoryDisplay: num(/Memory[\s\S]{0,40}?(\d+(?:\.\d+)?\s*MB)/i),
      memoryPercentile: num(/Memory[\s\S]{0,80}?Beats\s*(\d+(?:\.\d+)?)\s*%/i),
    };
  }

  function checkResult() {
    if (!alive()) { stopWatching(); return; }
    if (!watching) return;
    if (Date.now() - watchStarted > 40000) { stopWatching(); return; }

    const slug = currentSlug();
    if (!slug) return;

    let result = document.querySelector('[data-e2e-locator="submission-result"]');
    if (!result) {
      // Fallback for LeetCode layouts without the e2e hook: a result panel that
      // reports both a verdict and runtime stats.
      const panel = document.querySelector('[class*="result-container"], [class*="submission-result"], [data-cypress="SubmissionResult"]');
      if (panel && /Runtime|testcases passed/.test(panel.textContent || '')) result = panel;
    }
    if (!result || !/Accepted/.test(result.textContent || '')) return;
    stopWatching();

    const link = document.querySelector('a[href*="/submissions/detail/"]');
    const submissionId = (link?.getAttribute('href') || location.href).match(/\/submissions\/(?:detail\/)?(\d+)/)?.[1] || null;
    const key = submissionId || `${slug}@${watchStarted}`;
    if (reported.has(key)) return;
    reported.add(key);

    const container = result.closest('[class*="flex-col"]') || result.parentElement?.parentElement || document.body;
    const message = {
      type: 'SYNC_SUBMISSION',
      submissionId,
      titleSlug: slug,
      difficulty: difficultyFromPage(),
      ...metricsFromPage(container),
      solveSeconds: companion.slug === slug ? companion.seconds : null,
    };
    resetAttemptTimer(slug);

    try {
      chrome.runtime.sendMessage(message, res => {
        if (chrome.runtime.lastError || !res?.success || res.duplicate) return;
        showSolveToast(res);
        refreshCompanion();
      });
    } catch { /* extension reloaded */ }
  }

  function isSubmitButton(btn) {
    return btn.dataset.e2eLocator === 'console-submit-button' || (btn.textContent || '').trim() === 'Submit';
  }

  document.addEventListener('click', e => {
    const btn = e.target instanceof Element ? e.target.closest('button') : null;
    if (btn && isSubmitButton(btn)) startWatching();
  }, true);

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && currentSlug()) startWatching();
  }, true);

  new MutationObserver(() => { if (watching) checkResult(); })
    .observe(document.documentElement, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (msg?.type === 'SHOW_INPAGE_NOTIFICATION') {
      showAlert(String(msg.title || ''), String(msg.message || ''));
      sendResponse({ ok: true });
    }
    return false;
  });
})();
