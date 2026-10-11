document.addEventListener('DOMContentLoaded', () => {
  // Tab Navigation
  const navItems = document.querySelectorAll('.nav-item');
  const pages = document.querySelectorAll('.page');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetPage = item.getAttribute('data-page');

      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');

      pages.forEach(page => page.classList.remove('active'));
      document.getElementById(`page-${targetPage}`).classList.add('active');
    });
  });

  // Simulate Toast functionality
  const toast = document.getElementById('toast');
  function showToast(message) {
    toast.style.transform = 'translate(-50%, -150%)';
    toast.textContent = message;
    setTimeout(() => {
      toast.style.transform = 'translate(-50%, 100px)';
    }, 2000);
  }
  toast.style.cssText = "position: fixed; bottom: 20px; left: 50%; transform: translate(-50%, 100px); background: #0F172A; color: white; padding: 8px 16px; border-radius: 6px; transition: transform 0.2s; font-size: 13px; z-index: 1000;";

  // Add event listeners to demo buttons
  document.querySelectorAll('.btn-primary').forEach(btn => {
    btn.addEventListener('click', () => {
      // Determine button type
      if (btn.textContent.includes('Review')) {
        showToast('Opening review for #70...');
      } else if (btn.textContent.includes('Solve')) {
        showToast('Loading challenge...');
      } else if (btn.textContent.includes('Join')) {
        showToast('Joining squad...');
      } else if (btn.textContent.includes('Start')) {
        showToast('Duel started!');
      } else if (btn.textContent.includes('Light')) {
        document.body.style.background = '#FFFFFF';
        btn.className = 'btn-primary';
        btn.parentElement.children.forEach(b => b.className = 'btn-secondary');
        btn.className = 'btn-primary';
      }
    });
  });

  // Sync Buttons
  document.querySelectorAll('.github-utility .btn-secondary, .github-actions .btn-primary').forEach(btn => {
    if (btn.textContent.includes('Sync')) {
      btn.addEventListener('click', () => {
        let original = btn.textContent;
        btn.textContent = 'Syncing...';
        btn.disabled = true;
        setTimeout(() => {
          showToast('✓ 115 solutions synced');
          btn.textContent = original;
          btn.disabled = false;
        }, 1500);
      });
    }
  });

  // Chips
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });

  // Settings Disconnect
  document.querySelectorAll('.danger-text').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.textContent.includes('Disconnect') || btn.textContent.includes('Reset')) {
        if (confirm("Are you sure?")) {
          showToast('Action completed.');
        }
      }
    });
  });
});