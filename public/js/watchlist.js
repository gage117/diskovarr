/**
 * Watchlist helpers — used by app.js card rendering
 */
window.Watchlist = (function () {

  // ── Toast notification ────────────────────────────────────────────
  let toastTimeout = null;

  function showToast(message, type) {
    let toast = document.getElementById('wl-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'wl-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = 'wl-toast wl-toast-' + (type || 'add') + ' wl-toast-show';
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove('wl-toast-show'), 3000);
  }

  async function add(ratingKey) {
    const res = await fetch('/api/watchlist/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ratingKey }),
    });
    if (!res.ok) throw new Error('Failed to add to watchlist');
    return res.json();
  }

  async function remove(ratingKey) {
    const res = await fetch('/api/watchlist/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ratingKey }),
    });
    if (!res.ok) throw new Error('Failed to remove from watchlist');
    return res.json();
  }

  /**
   * Toggle watchlist status for a card.
   * btn: the watchlist button element
   * item: the recommendation item object
   */
  async function toggle(btn, item) {
    btn.disabled = true;
    try {
      if (item.isInWatchlist) {
        await remove(item.ratingKey);
        item.isInWatchlist = false;
        btn.classList.remove('in-watchlist');
        btn.textContent = '+ Watchlist';
        btn.title = 'Add to Diskovarr Watchlist';
      } else {
        await add(item.ratingKey);
        item.isInWatchlist = true;
        btn.classList.add('in-watchlist');
        btn.textContent = '✓ In Watchlist';
        btn.title = 'Remove from Diskovarr Watchlist';
        showToast('Added to your Diskovarr watchlist ◈', 'add');
      }
    } catch (err) {
      console.error('Watchlist toggle error:', err);
      showToast('Something went wrong. Try again.', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  return { add, remove, toggle };
})();
