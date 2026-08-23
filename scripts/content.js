/**
 * LeetSync Squads - In-Page LeetCode DOM & Submission Observer
 * Displays celebratory victory banners, confetti animations, and live squad presence.
 */

(function () {
  'use strict';

  // Guard against duplicate injection during SPA navigation
  if (window.__LEETSYNC_SQUADS_INJECTED__) return;
  window.__LEETSYNC_SQUADS_INJECTED__ = true;

  console.log('[LeetSync Squads] Content script initialized.');

  /**
   * Safe check to verify if the Chrome extension context is still valid.
   * Prevents "Extension context invalidated" errors when extension is reloaded.
   */
  function isExtensionValid() {
    try {
      return Boolean(typeof chrome !== 'undefined' && chrome?.runtime?.id);
    } catch {
      return false;
    }
  }

  function safeStorageSet(data) {
    if (!isExtensionValid()) return;
    try {
      chrome.storage.local.set(data).catch(() => {});
    } catch (e) {
      // Extension context invalidated - safe to ignore
    }
  }

  function safeSendMessage(message, callback) {
    if (!isExtensionValid()) return;
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (!isExtensionValid()) return;
        if (chrome.runtime.lastError) {
          // Suppress error if context was invalidated during transit
          return;
        }
        if (callback) callback(response);
      });
    } catch (e) {
      // Extension context invalidated - safe to ignore
    }
  }

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
  /**
   * Extract authentic performance metrics (Runtime ms, Memory MB, Beats %) directly from LeetCode DOM.
   */
  function extractSubmissionMetricsFromDOM() {
    const result = {
      runtimeDisplay: '0 ms',
      runtimePercentile: null,
      memoryDisplay: '0 MB',
      memoryPercentile: null,
    };

    try {
      const containers = [
        document.querySelector('[data-e2e-locator="submission-result"]'),
        document.querySelector('[class*="result-container"], [class*="submission-result"], [data-cypress="SubmissionResult"], [class*="result-state"]'),
        document.body
      ];

      let fullText = '';
      for (const c of containers) {
        if (c && c.innerText && (c.innerText.includes('Runtime') || c.innerText.includes('Memory') || c.innerText.includes('Accepted'))) {
          fullText = c.innerText;
          break;
        }
      }
      if (!fullText) fullText = document.body?.innerText || '';

      // 1. Runtime Display (e.g., "12 ms", "45 ms", "0.5 s")
      const runtimeMatch = fullText.match(/Runtime\s*[:\n\r]*\s*(\d+(?:\.\d+)?\s*(?:ms|s))/i) || fullText.match(/(\d+(?:\.\d+)?\s*ms)/i);
      if (runtimeMatch) {
        result.runtimeDisplay = runtimeMatch[1].trim();
      }

      // 2. Memory Display (e.g., "12.63 MB", "14.2 MB", "4200 KB")
      const memoryMatch = fullText.match(/Memory\s*[:\n\r]*\s*(\d+(?:\.\d+)?\s*(?:MB|KB|GB))/i) || fullText.match(/(\d+(?:\.\d+)?\s*(?:MB|KB))/i);
      if (memoryMatch) {
        result.memoryDisplay = memoryMatch[1].trim();
      }

      // 3. Runtime Percentile (e.g., "Runtime ... Beats 83.46%")
      const runtimeBeatsMatch = fullText.match(/Runtime[\s\S]*?Beats\s*(\d+(?:\.\d+)?)\s*%/i) || fullText.match(/Beats\s*(\d+(?:\.\d+)?)\s*%/i);
      if (runtimeBeatsMatch) {
        result.runtimePercentile = parseFloat(runtimeBeatsMatch[1]);
      }

      // 4. Memory Percentile (e.g., "Memory ... Beats 75.74%")
      const memoryBeatsMatch = fullText.match(/Memory[\s\S]*?Beats\s*(\d+(?:\.\d+)?)\s*%/i);
      if (memoryBeatsMatch) {
        result.memoryPercentile = parseFloat(memoryBeatsMatch[1]);
      }
    } catch (err) {
      console.warn('[LeetSync Content] DOM metrics parsing notice:', err);
    }

    return result;
  }

  /**
   * Extract editor solution code from Monaco / CodeMirror DOM elements.
   */
  function extractCodeFromDOM() {
    try {
      const monacoLines = document.querySelectorAll('.view-lines .view-line');
      if (monacoLines && monacoLines.length > 0) {
        return Array.from(monacoLines).map(l => l.innerText).join('\n');
      }
      const codeArea = document.querySelector('textarea.monaco-mouse-cursor-text, .CodeMirror-code, pre code');
      if (codeArea) return codeArea.value || codeArea.innerText;
    } catch (e) {}
    return '';
  }

  /**
   * Display modern slide-in celebration toast upon "Accepted" verdict with authentic metrics.
   */
  function showVictoryToast(data) {
    // Remove existing toast if any
    const existing = document.getElementById('leetsync-victory-toast');
    if (existing) existing.remove();

    launchConfetti();

    const toast = document.createElement('div');
    toast.id = 'leetsync-victory-toast';
    toast.className = 'leetsync-toast-enter';

    const rtPercentile = data.runtimePercentile !== undefined && data.runtimePercentile !== null && !isNaN(parseFloat(data.runtimePercentile))
      ? parseFloat(data.runtimePercentile)
      : null;
    const memPercentile = data.memoryPercentile !== undefined && data.memoryPercentile !== null && !isNaN(parseFloat(data.memoryPercentile))
      ? parseFloat(data.memoryPercentile)
      : null;

    const runtimePct = rtPercentile !== null ? `Beats ${rtPercentile.toFixed(1)}%` : 'Accepted';
    const memoryPct = memPercentile !== null ? ` (Beats ${memPercentile.toFixed(1)}%)` : '';
    const runtimeTitle = (rtPercentile && rtPercentile > 80) ? '🚀 Speed Demon' : '⚡ Synced';

    toast.innerHTML = `
      <div class="leetsync-toast-header">
        <div class="leetsync-toast-title">
          <span class="leetsync-flame-icon">🔥</span>
          <span>LeetX Squads</span>
        </div>
        <button class="leetsync-toast-close" id="leetsync-toast-close-btn">&times;</button>
      </div>
      <div class="leetsync-toast-body">
        <div class="leetsync-toast-badge">${runtimeTitle}</div>
        <div class="leetsync-toast-msg">Problem pushed to GitHub with authentic metrics!</div>
        <div class="leetsync-toast-stats">
          <span>⏱️ ${data.runtimeDisplay || '0 ms'} (${runtimePct})</span>
          <span>💾 ${data.memoryDisplay || '0 MB'}${memoryPct}</span>
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
  /**
   * Intercept submission results from LeetCode GraphQL / DOM.
   */
  const processedSubmissions = new Set();
  let isSubmittingLive = false;
  let submissionStartTime = 0;
  let pollInterval = null;

  function triggerSubmissionDetection() {
    isSubmittingLive = true;
    submissionStartTime = Date.now();
    startSubmissionPolling();
  }

  function startSubmissionPolling() {
    if (pollInterval) clearInterval(pollInterval);
    let attempts = 0;
    pollInterval = setInterval(() => {
      if (!isExtensionValid()) {
        clearInterval(pollInterval);
        pollInterval = null;
        isSubmittingLive = false;
        return;
      }
      attempts++;
      if (!isSubmittingLive || attempts > 50) {
        clearInterval(pollInterval);
        pollInterval = null;
        isSubmittingLive = false;
        return;
      }
      checkForAcceptedSolve();
    }, 600);
  }

  function extractDifficultyFromDOM() {
    const diffEl = document.querySelector('[class*="text-difficulty-"], [class*="text-sd-easy"], [class*="text-sd-medium"], [class*="text-sd-hard"], [class*="text-easy"], [class*="text-medium"], [class*="text-hard"], [data-degree]');
    if (diffEl) {
      const text = diffEl.innerText.trim();
      if (/easy/i.test(text)) return 'Easy';
      if (/hard/i.test(text)) return 'Hard';
      if (/med/i.test(text)) return 'Medium';
    }
    return 'Medium';
  }

  function checkForAcceptedSolve() {
    if (!isExtensionValid()) {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      isSubmittingLive = false;
      return;
    }

    // Only check if user has actively clicked Submit or pressed shortcut within the last 35 seconds
    if (!isSubmittingLive) return;
    if (Date.now() - submissionStartTime > 35000) {
      isSubmittingLive = false;
      return;
    }

    const slug = getCurrentTitleSlug();
    if (!slug) return;

    // Specifically target submission result containers/modals, not static text on the page
    const successEl = document.querySelector('[data-e2e-locator="submission-result"]');
    const resultBox = document.querySelector('[class*="result-container"], [class*="submission-result"], [data-cypress="SubmissionResult"], [class*="result-state"]');

    let isAccepted = false;
    if (successEl && (successEl.innerText.includes('Accepted') || successEl.innerText.includes('Success'))) {
      isAccepted = true;
    } else if (resultBox && (resultBox.innerText.includes('Accepted') || resultBox.innerText.includes('Success')) && (resultBox.innerText.includes('Runtime') || resultBox.innerText.includes('Beats') || resultBox.innerText.includes('testcases passed'))) {
      isAccepted = true;
    }

    if (!isAccepted) return;

    // Confirmed accepted verdict for the live active submission
    isSubmittingLive = false; // Immediately disable to prevent re-triggering

    // Extract submission id from link or URL or generate a unique deterministic key for this solve
    const link = document.querySelector('a[href*="/submissions/detail/"], a[href*="/submissions/"]');
    const match = link?.href?.match(/\/submissions\/(?:detail\/)?(\d+)/) || window.location.href.match(/\/submissions\/(\d+)/);
    const subId = match ? match[1] : `sub_${slug}_${Math.floor(submissionStartTime / 1000)}`;

    const submissionKey = `${slug}_${subId}`;
    if (processedSubmissions.has(submissionKey)) return;
    processedSubmissions.add(submissionKey);

    const difficulty = extractDifficultyFromDOM();
    const metrics = extractSubmissionMetricsFromDOM();
    const code = extractCodeFromDOM();
    const diffNorm = difficulty.toLowerCase();
    const defaultXp = diffNorm === 'hard' ? 50 : (diffNorm === 'easy' ? 10 : 25);

    console.log(`[LeetSync Squads] Verified Live Accepted Submission for "${slug}" [${difficulty}] (ID: ${subId})`, metrics);

    const payload = {
      type: 'SYNC_SUBMISSION',
      submissionId: subId,
      titleSlug: slug,
      difficulty,
      code,
      runtimeDisplay: metrics.runtimeDisplay,
      runtimePercentile: metrics.runtimePercentile,
      memoryDisplay: metrics.memoryDisplay,
      memoryPercentile: metrics.memoryPercentile,
    };

    safeSendMessage(payload, (response) => {
      let liveMetrics = extractSubmissionMetricsFromDOM();
      if (!liveMetrics.runtimeDisplay || liveMetrics.runtimeDisplay === '0 ms') {
        liveMetrics = metrics;
      }

      const toastData = {
        ...response,
        runtimeDisplay: liveMetrics.runtimeDisplay || response?.runtimeDisplay || '0 ms',
        runtimePercentile: liveMetrics.runtimePercentile !== null ? liveMetrics.runtimePercentile : (response?.runtimePercentile ?? null),
        memoryDisplay: liveMetrics.memoryDisplay || response?.memoryDisplay || '0 MB',
        memoryPercentile: liveMetrics.memoryPercentile !== null ? liveMetrics.memoryPercentile : (response?.memoryPercentile ?? null),
        xpEarned: response?.xpEarned || defaultXp,
      };

      showVictoryToast(toastData);
    });

    // Refresh stats after short delays so LeetCode backend updates are captured
    setTimeout(syncLeetCodeProfileStats, 1500);
    setTimeout(syncLeetCodeProfileStats, 3500);
  }

  function getInPageCsrfToken() {
    try {
      const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
      return match ? match[1] : '';
    } catch {
      return '';
    }
  }

  /**
   * Scrape stats directly from DOM elements on LeetCode user profile pages.
   */
  function scrapeProfileDOM() {
    if (!isExtensionValid()) return;
    try {
      const path = window.location.pathname;
      const userMatch = path.match(/\/(?:u|profile)\/([a-zA-Z0-9_-]+)/i);
      if (userMatch && userMatch[1]) {
        safeStorageSet({ leetcode_username: userMatch[1] });
      }

      const pageText = document.body.innerText || '';
      // Look for patterns like "115/4033 Solved" or "Easy 71/961"
      const totalMatch = pageText.match(/(\d+)\s*\/\s*\d+\s*(?:Solved|solved)/i);
      const easyMatch = pageText.match(/Easy\s*(\d+)\s*\/\s*\d+/i) || pageText.match(/(\d+)\s*\/\s*\d+\s*Easy/i);
      const medMatch = pageText.match(/Med(?:ium|\.)?\s*(\d+)\s*\/\s*\d+/i) || pageText.match(/(\d+)\s*\/\s*\d+\s*Med/i);
      const hardMatch = pageText.match(/Hard\s*(\d+)\s*\/\s*\d+/i) || pageText.match(/(\d+)\s*\/\s*\d+\s*Hard/i);

      if (totalMatch && totalMatch[1]) {
        const total = parseInt(totalMatch[1], 10);
        const easy = easyMatch ? parseInt(easyMatch[1], 10) : 0;
        const med = medMatch ? parseInt(medMatch[1], 10) : 0;
        const hard = hardMatch ? parseInt(hardMatch[1], 10) : 0;

        if (total > 0) {
          safeStorageSet({
            total_solved: total,
            solved_easy_count: easy,
            solved_med_count: med,
            solved_hard_count: hard,
          });
        }
      }
    } catch (e) {}
  }

  /**
   * Automatically detect logged-in username and live solve statistics on LeetCode.
   */
  function syncLeetCodeProfileStats() {
    if (!isExtensionValid()) return;
    try {
      // 1. Instant DOM scraping for profile pages
      scrapeProfileDOM();

      // 2. Scrape from __NEXT_DATA__
      const nextDataEl = document.getElementById('__NEXT_DATA__');
      if (nextDataEl) {
        try {
          const nextData = JSON.parse(nextDataEl.innerText);
          const props = nextData?.props?.pageProps;
          const userStatus = props?.userStatus;
          const userProfile = props?.userProfile || props?.profile;
          const submitStats = props?.submitStatsGlobal || props?.submitStats || userProfile?.submitStatsGlobal || userProfile?.submitStats;

          const lcUser = userStatus?.username || userProfile?.userSlug || userProfile?.username;
          if (lcUser) {
            safeStorageSet({ leetcode_username: lcUser });
          }

          if (submitStats?.acSubmissionNum) {
            const acList = submitStats.acSubmissionNum;
            const getCount = (d) => acList.find(x => x.difficulty.toLowerCase() === d.toLowerCase())?.count || 0;
            const total = getCount('all');
            const easy = getCount('easy');
            const med = getCount('medium');
            const hard = getCount('hard');
            if (total > 0) {
              safeStorageSet({
                total_solved: total,
                solved_easy_count: easy,
                solved_med_count: med,
                solved_hard_count: hard,
              });
            }
          }
        } catch (jsonErr) {}
      }

      // 3. Query authenticated GraphQL endpoint directly within page context
      const csrf = getInPageCsrfToken();
      const headers = { 'Content-Type': 'application/json' };
      if (csrf) headers['x-csrftoken'] = csrf;

      fetch('https://leetcode.com/graphql', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          query: `
            query userSessionAndStats {
              userStatus {
                isSignedIn
                username
              }
            }
          `
        })
      }).then(r => r.json()).then(res => {
        if (!isExtensionValid()) return;
        let username = res?.data?.userStatus?.username;
        if (!username) {
          const userMatch = window.location.pathname.match(/\/(?:u|profile)\/([a-zA-Z0-9_-]+)/i);
          if (userMatch && userMatch[1]) username = userMatch[1];
        }

        if (username) {
          safeStorageSet({ leetcode_username: username });

          fetch('https://leetcode.com/graphql', {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify({
              query: `
                query userProfileStats($username: String!) {
                  matchedUser(username: $username) {
                    submitStatsGlobal {
                      acSubmissionNum {
                        difficulty
                        count
                      }
                    }
                    submitStats {
                      acSubmissionNum {
                        difficulty
                        count
                      }
                    }
                  }
                }
              `,
              variables: { username }
            })
          }).then(r => r.json()).then(statsRes => {
            if (!isExtensionValid()) return;
            const user = statsRes?.data?.matchedUser;
            const acList = user?.submitStatsGlobal?.acSubmissionNum || user?.submitStats?.acSubmissionNum || [];
            if (acList.length > 0) {
              const getCount = (d) => acList.find(x => x.difficulty.toLowerCase() === d.toLowerCase())?.count || 0;
              const total = getCount('all') || (getCount('easy') + getCount('medium') + getCount('hard'));
              const easy = getCount('easy');
              const med = getCount('medium');
              const hard = getCount('hard');
              if (total > 0) {
                safeStorageSet({
                  total_solved: total,
                  solved_easy_count: easy,
                  solved_med_count: med,
                  solved_hard_count: hard,
                });
              }
            }
          }).catch(() => {});
        }
      }).catch(() => {});
    } catch (e) {
      console.warn('[LeetSync Content] Profile sync notice:', e);
    }
  }

  function observeSubmissions() {
    if (!isExtensionValid()) return;

    // 1. Mutation Observer for DOM changes (only check for solves if a live submission is underway)
    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      if (!isExtensionValid()) {
        observer.disconnect();
        return;
      }
      if (isSubmittingLive) {
        checkForAcceptedSolve();
      }
      if (window.location.pathname.includes('/u/') || window.location.pathname.includes('/profile/')) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(syncLeetCodeProfileStats, 800);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 2. Active Trigger when Submit button is clicked
    document.addEventListener('click', (e) => {
      if (!isExtensionValid()) return;
      const target = e.target.closest('button');
      if (target) {
        const text = (target.innerText || '').trim();
        if (text === 'Submit' || target.dataset.e2eLocator === 'console-submit-button' || target.getAttribute('data-cypress') === 'SubmitCode') {
          triggerSubmissionDetection();
        }
      }
    });

    // 3. Active Trigger on keyboard shortcut (Ctrl+Enter / Cmd+Enter)
    document.addEventListener('keydown', (e) => {
      if (!isExtensionValid()) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        triggerSubmissionDetection();
      }
    });

    // Sync profile stats on initial load without firing phantom victory toasts
    syncLeetCodeProfileStats();
  }

  // Start observing when page is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeSubmissions);
  } else {
    observeSubmissions();
  }

  // Also sync profile after a short delay
  setTimeout(syncLeetCodeProfileStats, 1500);

  // Listen for broadcast alerts from background or popup
  try {
    if (typeof chrome !== 'undefined' && chrome?.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === 'SHOW_INPAGE_NOTIFICATION') {
          showInPageAlert(msg.title, msg.message);
          sendResponse({ received: true });
        }
      });
    }
  } catch (e) {}

    function showInPageAlert(title, message) {
      const existing = document.getElementById('leetsync-inpage-alert');
      if (existing) existing.remove();

      const banner = document.createElement('div');
      banner.id = 'leetsync-inpage-alert';
      banner.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999999;
        background: #0F172A;
        color: #FFFFFF;
        border: 1px solid #334155;
        border-radius: 10px;
        padding: 12px 16px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.4);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        max-width: 320px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        animation: leetsyncSlideIn 0.3s ease;
      `;
      banner.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
          <span style="font-size: 13px; font-weight: 700; color: #38BDF8;">${title || 'LeetX'}</span>
          <button id="leetsync-alert-close" style="background: none; border: none; color: #94A3B8; cursor: pointer; font-size: 16px; line-height: 1;">&times;</button>
        </div>
        <div style="font-size: 12px; color: #E2E8F0; line-height: 1.35;">${message || ''}</div>
      `;
      document.body.appendChild(banner);
      document.getElementById('leetsync-alert-close')?.addEventListener('click', () => banner.remove());
      setTimeout(() => { if (document.body.contains(banner)) banner.remove(); }, 6000);
    }
  })();
