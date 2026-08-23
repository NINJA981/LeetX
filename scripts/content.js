/**
 * LeetSync Squads - In-Page LeetCode DOM & Submission Observer
 * Displays celebratory victory banners, confetti animations, and live squad presence.
 */

(function () {
  'use strict';

  console.log('[LeetSync Squads] Content script initialized.');

  /**
   * Embedded Canvas Confetti Engine (Zero external CDN dependency for 100% offline safety & CSP compliance).
   */
  function launchConfetti() {
    const canvas = document.createElement('canvas');
    canvas.id = 'leetsync-confetti-canvas';
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '999999';
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = [];
    const colors = ['#10B981', '#3B82F6', '#F59E0B', '#EC4899', '#8B5CF6', '#FBBF24'];

    for (let i = 0; i < 90; i++) {
      particles.push({
        x: canvas.width / 2,
        y: canvas.height / 2 + 100,
        vx: (Math.random() - 0.5) * 18,
        vy: (Math.random() - 0.9) * 16 - 4,
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rSpeed: (Math.random() - 0.5) * 12,
        alpha: 1,
      });
    }

    let animationFrame;
    function render() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.4; // Gravity
        p.rotation += p.rSpeed;
        p.alpha -= 0.012;

        if (p.alpha > 0) {
          alive = true;
          ctx.save();
          ctx.globalAlpha = p.alpha;
          ctx.translate(p.x, p.y);
          ctx.rotate((p.rotation * Math.PI) / 180);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
          ctx.restore();
        }
      }

      if (alive) {
        animationFrame = requestAnimationFrame(render);
      } else {
        cancelAnimationFrame(animationFrame);
        canvas.remove();
      }
    }

    render();
  }

  /**
   * Display modern slide-in celebration toast upon "Accepted" verdict.
   */
  function showVictoryToast(data) {
    // Remove existing toast if any
    const existing = document.getElementById('leetsync-victory-toast');
    if (existing) existing.remove();

    launchConfetti();

    const toast = document.createElement('div');
    toast.id = 'leetsync-victory-toast';
    toast.className = 'leetsync-toast-enter';

    const runtimePct = data.runtimePercentile ? `Beats ${parseFloat(data.runtimePercentile).toFixed(1)}%` : 'Accepted';
    const runtimeTitle = (data.runtimePercentile && data.runtimePercentile > 85) ? '🚀 Speed Demon' : '⚡ Synced';

    toast.innerHTML = `
      <div class="leetsync-toast-header">
        <div class="leetsync-toast-title">
          <span class="leetsync-flame-icon">🔥</span>
          <span>LeetSync Squads</span>
        </div>
        <button class="leetsync-toast-close" id="leetsync-toast-close-btn">&times;</button>
      </div>
      <div class="leetsync-toast-body">
        <div class="leetsync-toast-badge">${runtimeTitle}</div>
        <div class="leetsync-toast-msg">Problem pushed to GitHub with authentic metrics!</div>
        <div class="leetsync-toast-stats">
          <span>⏱️ ${data.runtimeDisplay || '0 ms'} (${runtimePct})</span>
          <span>💾 ${data.memoryDisplay || '0 MB'}</span>
          <span>🌟 +${data.xpEarned || 25} XP</span>
        </div>
      </div>
    `;

    document.body.appendChild(toast);

    document.getElementById('leetsync-toast-close-btn')?.addEventListener('click', () => {
      toast.classList.add('leetsync-toast-leave');
      setTimeout(() => toast.remove(), 350);
    });

    // Auto dismiss after 7 seconds
    setTimeout(() => {
      if (document.body.contains(toast)) {
        toast.classList.add('leetsync-toast-leave');
        setTimeout(() => toast.remove(), 350);
      }
    }, 7000);
  }

  /**
   * Extract title slug from current LeetCode URL (e.g. /problems/two-sum/ -> two-sum).
   */
  function getCurrentTitleSlug() {
    const match = window.location.pathname.match(/\/problems\/([a-z0-9-]+)/i);
    return match ? match[1] : null;
  }

  /**
   * Intercept submission results from LeetCode GraphQL / DOM.
   */
  let lastHandledSubmissionId = null;

  function observeSubmissions() {
    // Check DOM for submission result banner
    const observer = new MutationObserver(() => {
      const successEl = document.querySelector('[data-e2e-locator="submission-result"]');
      const textContent = document.body.innerText;

      if (
        (successEl && (successEl.innerText.includes('Accepted') || successEl.innerText.includes('Success'))) ||
        (document.querySelector('.text-green-s, .text-success') && textContent.includes('Runtime') && textContent.includes('Memory'))
      ) {
        // Attempt to extract submission ID from URL or page state
        const slug = getCurrentTitleSlug();
        if (!slug) return;

        // Try extracting submission id from submission detail links
        const link = document.querySelector('a[href*="/submissions/detail/"]');
        const match = link?.href.match(/\/submissions\/detail\/(\d+)/);
        const subId = match ? match[1] : null;

        if (subId && subId !== lastHandledSubmissionId) {
          lastHandledSubmissionId = subId;
          console.log(`[LeetSync Squads] Detected Accepted Submission #${subId} for "${slug}"`);

          chrome.runtime.sendMessage(
            { type: 'SYNC_SUBMISSION', submissionId: subId, titleSlug: slug },
            (response) => {
              if (response && response.success) {
                showVictoryToast(response);
              } else {
                console.warn('[LeetSync Squads] Sync warning:', response?.error);
              }
            }
          );
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Start observing when page is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeSubmissions);
  } else {
    observeSubmissions();
  }
})();
