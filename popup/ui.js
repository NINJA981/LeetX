/**
 * Minimal DOM toolkit for the popup. Everything is built with createElement /
 * textContent; icon markup is static and authored here, never remote data.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICON_PATHS = {
  flame: ['M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z'],
  check: ['M20 6 9 17l-5-5'],
  bolt: ['M13 2 3 14h9l-1 8 10-12h-9l1-8z'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  swords: ['M14.5 17.5 3 6V3h3l11.5 11.5', 'm13 19 6-6', 'm16 16 4 4', 'm19 21 2-2', 'M14.5 6.5 18 3h3v3l-3.5 3.5', 'm5 14 4 4', 'm7 17-3 3', 'm3 19 2 2'],
  map: ['M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z', 'M15 5.764v15', 'M9 3.236v15'],
  home: ['M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8', 'M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  settings: ['M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  github: ['M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4', 'M9 18c-4.51 2-5-2-7-2'],
  copy: ['M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z', 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'],
  refresh: ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'],
  bell: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  chevronRight: ['m9 18 6-6-6-6'],
  chevronLeft: ['m15 18-6-6 6-6'],
  external: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
  logOut: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'],
  trophy: ['M6 9H4.5a2.5 2.5 0 0 1 0-5H6', 'M18 9h1.5a2.5 2.5 0 0 0 0-5H18', 'M4 22h16', 'M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22', 'M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22', 'M18 2H6v7a6 6 0 0 0 12 0V2Z'],
  clock: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M12 6v6l4 2'],
  plus: ['M5 12h14', 'M12 5v14'],
  search: ['M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', 'm21 21-4.3-4.3'],
  pencil: ['M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z', 'm15 5 4 4'],
  target: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12z', 'M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z'],
  shuffle: ['m18 14 4 4-4 4', 'm18 2 4 4-4 4', 'M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22', 'M2 6h1.9c1.5 0 2.9.9 3.6 2.2', 'M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8'],
  crown: ['M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z', 'M5 21h14'],
  more: ['M12 12h.01', 'M19 12h.01', 'M5 12h.01'],
  lock: ['M7 11V7a5 5 0 0 1 10 0v4', 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z'],
  userMinus: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M22 11h-6'],
  userPlus: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M19 8v6', 'M22 11h-6'],
  sun: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 2v2', 'M12 20v2', 'm4.93 4.93 1.41 1.41', 'm17.66 17.66 1.41 1.41', 'M2 12h2', 'M20 12h2', 'm6.34 17.66-1.41 1.41', 'm19.07 4.93-1.41 1.41'],
  moon: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'],
  monitor: ['M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M8 21h8', 'M12 17v4'],
  sparkles: ['M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z'],
  calendar: ['M8 2v4', 'M16 2v4', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M3 10h18'],
  arrowRight: ['M5 12h14', 'm12 5 7 7-7 7'],
  rotate: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
  flag: ['M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z', 'M4 22v-7'],
  alert: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M12 8v4', 'M12 16h.01'],
  logIn: ['M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4', 'm10 17 5-5-5-5', 'M15 12H3'],
  snowflake: ['M2 12h20', 'M12 2v20', 'm20 16-4-4 4-4', 'm4 8 4 4-4 4', 'm16 4-4 4-4-4', 'm8 20 4-4 4 4'],
  chart: ['M3 3v16a2 2 0 0 0 2 2h16', 'M18 17V9', 'M13 17V5', 'M8 17v-3'],
  award: ['m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526', 'M12 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z'],
  circleCheck: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'm9 12 2 2 4-4'],
  circle: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z'],
  pin: ['M12 17v5', 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z'],
};

export function icon(name, { size = 16, className = '' } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon ${className}`.trim());
  for (const d of ICON_PATHS[name] || []) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

/**
 * h('div.row.is-active', { onclick, 'aria-label': 'x', dataset: {...} }, child, 'text', [more])
 * Strings become text nodes; null/false children are skipped.
 */
export function h(selector, props, ...children) {
  const [head, ...classes] = selector.split('.');
  const [tag, id] = head.split('#');
  const el = document.createElement(tag || 'div');
  if (id) el.id = id;
  if (classes.length) el.className = classes.join(' ');

  if (props !== null && props !== undefined && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = [el.className, value].filter(Boolean).join(' ');
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, String(v));
        else el.style[prop] = v;
      }
    }
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function mount(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

// ---------------------------------------------------------------------------
// Small components
// ---------------------------------------------------------------------------

export function button(label, { variant = 'secondary', size = 'md', iconName = null, iconRight = null, ...props } = {}) {
  return h(`button.btn.btn-${variant}.btn-${size}`, { type: 'button', ...props },
    iconName ? icon(iconName, { size: size === 'sm' ? 14 : 16 }) : null,
    label ? h('span', label) : null,
    iconRight ? icon(iconRight, { size: size === 'sm' ? 14 : 16 }) : null,
  );
}

export function iconButton(name, label, props = {}) {
  return h('button.icon-btn', { type: 'button', 'aria-label': label, title: label, ...props }, icon(name));
}

export function difficultyTag(difficulty) {
  const d = String(difficulty || 'Medium');
  return h(`span.diff.diff-${d.toLowerCase()}`, d);
}

const AVATAR_HUES = [350, 20, 38, 145, 170, 200, 225, 260, 290, 320];
export function avatar(name, { size = 28, ring = null } = {}) {
  const clean = String(name || '?').trim();
  let hash = 0;
  for (const ch of clean) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const hue = AVATAR_HUES[Math.abs(hash) % AVATAR_HUES.length];
  const initials = clean.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
  return h(`span.avatar${ring ? `.ring-${ring}` : ''}`, {
    style: { '--hue': hue, width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px` },
    'aria-hidden': 'true',
  }, initials);
}

export function toggle(checked, onChange, label) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked: Boolean(checked), 'aria-label': label });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label.switch', input, h('span.switch-track', h('span.switch-thumb')));
}

export function segmented(options, value, onChange, { label, size = 'md' } = {}) {
  const group = h(`div.segmented.segmented-${size}`, { role: 'radiogroup', 'aria-label': label });
  for (const opt of options) {
    const active = opt.value === value;
    group.appendChild(h('button.segment', {
      type: 'button',
      role: 'radio',
      'aria-checked': String(active),
      class: active ? 'is-active' : '',
      onclick: () => onChange(opt.value),
    }, opt.icon ? icon(opt.icon, { size: 14 }) : null, opt.label ? h('span', opt.label) : null));
  }
  return group;
}

export function progressBar(fraction, { tone = 'accent', label } = {}) {
  const pct = Math.max(0, Math.min(1, Number(fraction) || 0)) * 100;
  return h(`div.bar.bar-${tone}`, { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(pct), 'aria-label': label },
    h('div.bar-fill', { style: { width: `${pct}%` } }));
}

export function sectionHeader(title, ...right) {
  return h('div.section-head', h('h2.section-title', title), right.length ? h('div.section-actions', right) : null);
}

export function emptyState({ iconName, title, body, actions = [] }) {
  return h('div.empty',
    iconName ? h('div.empty-icon', icon(iconName, { size: 20 })) : null,
    h('div.empty-title', title),
    body ? h('p.empty-body', body) : null,
    actions.length ? h('div.empty-actions', actions) : null,
  );
}

export function skeleton(lines = 2) {
  return h('div.skeleton', Array.from({ length: lines }, (_, i) => h('div.skeleton-line', { style: { width: `${i === 0 ? 70 : 45}%` } })));
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

let toastTimer = null;
export function toast(message, { tone = 'neutral', action = null } = {}) {
  const region = document.getElementById('toast-region');
  if (!region) return;
  clearTimeout(toastTimer);
  const node = h(`div.toast.toast-${tone}`, { role: 'status' },
    tone === 'success' ? icon('check', { size: 14 }) : tone === 'error' ? icon('alert', { size: 14 }) : null,
    h('span', message),
    action ? h('button.toast-action', { type: 'button', onclick: () => { action.onClick(); node.remove(); } }, action.label) : null,
  );
  mount(region, node);
  requestAnimationFrame(() => node.classList.add('in'));
  toastTimer = setTimeout(() => {
    node.classList.remove('in');
    setTimeout(() => node.remove(), 200);
  }, 3200);
}

/** Button that needs a second click within 4s to fire - for destructive actions. */
export function confirmButton(label, confirmLabel, onConfirm, opts = {}) {
  const btn = button(label, { variant: 'danger-ghost', size: 'sm', ...opts });
  let armed = false;
  let timer = null;
  btn.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      btn.classList.add('is-armed');
      btn.querySelector('span').textContent = confirmLabel;
      timer = setTimeout(() => {
        armed = false;
        btn.classList.remove('is-armed');
        btn.querySelector('span').textContent = label;
      }, 4000);
      return;
    }
    clearTimeout(timer);
    btn.disabled = true;
    try {
      await onConfirm();
    } catch (err) {
      console.warn('[LeetX]', err);
      toast(err?.message || 'Something went wrong', { tone: 'error' });
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}

/**
 * In-app replacement for window.confirm(): a themed bottom sheet.
 * Resolves true on confirm, false on cancel, Escape or backdrop click.
 */
export function confirmDialog({ title, body = null, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise(resolve => {
    const finish = value => {
      sheet.classList.remove('in');
      backdrop.classList.remove('in');
      setTimeout(() => backdrop.remove(), 200);
      resolve(value);
    };
    const cancelBtn = button(cancelLabel, { variant: 'secondary', onclick: () => finish(false) });
    const sheet = h('div.sheet.sheet-confirm', { role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title },
      h('div.sheet-grip'),
      h('h2.sheet-title', title),
      body ? h('p.muted', body) : null,
      h('div.confirm-actions', cancelBtn, button(confirmLabel, { variant: danger ? 'danger' : 'primary', onclick: () => finish(true) })),
    );
    const backdrop = h('div.sheet-backdrop', sheet);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) finish(false); });
    backdrop.addEventListener('close', () => finish(false));
    document.getElementById('app').appendChild(backdrop);
    requestAnimationFrame(() => { backdrop.classList.add('in'); sheet.classList.add('in'); });
    cancelBtn.focus({ preventScroll: true });
  });
}

/** Wrap an async click handler: disables the button and shows errors as a toast. */
export function busy(handler) {
  return async event => {
    const btn = event?.currentTarget;
    if (btn?.disabled) return;
    if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
    try {
      await handler(event);
    } catch (err) {
      console.warn('[LeetX]', err);
      toast(err?.message || 'Something went wrong', { tone: 'error' });
    } finally {
      if (btn?.isConnected) { btn.disabled = false; btn.classList.remove('is-busy'); }
    }
  };
}

export function openExternal(url) {
  chrome.tabs.create({ url });
  window.close();
}

export function problemUrl(slug) {
  return `https://leetcode.com/problems/${encodeURIComponent(slug)}/`;
}
