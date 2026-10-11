import { button, h, icon } from '../ui.js';
import { githubConnectForm } from './github-connect.js';

let step = 0;

const VALUE_PROPS = [
  { icon: 'flame', title: 'A streak worth protecting', body: 'Your toolbar shows the streak. A reminder comes in the evening only if you haven\'t solved yet.' },
  { icon: 'users', title: 'Squads and 1v1 duels', body: 'See who solved today, nudge friends, and race on a hidden problem.' },
  { icon: 'github', title: 'Every solve on GitHub', body: 'Code, runtime and your notes, one clean commit per problem.' },
];

export function renderOnboarding(ctx) {
  const finish = async () => {
    step = 0;
    await ctx.set({ onboarded: true });
    ctx.navigate('today');
  };

  if (step === 0) {
    return h('div.onboarding',
      h('div.onboard-hero',
        h('img.onboard-mark', { src: '../assets/icons/icon128.png', alt: '', width: 48, height: 48 }),
        h('h1.onboard-title', 'Show up for LeetCode every day'),
        h('p.onboard-lede', 'LeetX turns practice into a habit you keep, with friends who notice when you skip.'),
      ),
      h('ul.props', VALUE_PROPS.map(p => h('li.prop',
        h('span.prop-icon', icon(p.icon, { size: 16 })),
        h('div', h('div.prop-title', p.title), h('div.prop-body', p.body)),
      ))),
      h('div.onboard-actions',
        button('Get started', { variant: 'primary', class: 'btn-block', iconRight: 'arrowRight', onclick: () => { step = 1; ctx.rerender(); } }),
      ),
    );
  }

  return h('div.onboarding',
    h('div.onboard-step-head',
      h('button.link-btn', { type: 'button', onclick: () => { step = 0; ctx.rerender(); } }, icon('chevronLeft', { size: 14 }), 'Back'),
      h('span.muted', 'Optional'),
    ),
    h('h1.onboard-title.left', 'Back up your solutions'),
    h('p.onboard-lede.left', 'Connect GitHub and LeetX commits every accepted solution to a repository you own, including the ones you solved before installing.'),
    githubConnectForm(ctx, { onConnected: finish }),
    button('Skip for now', { variant: 'ghost', class: 'btn-block', onclick: finish }),
  );
}
