const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const plexService = require('../services/plex');
const recommender = require('../services/recommender');
const db = require('../db/database');

router.use(requireAuth);

// GET /api/recommendations
router.get('/recommendations', async (req, res) => {
  try {
    const { id: userId, token: userToken } = req.session.plexUser;
    const data = await recommender.getRecommendations(userId, userToken);
    res.json(data);
  } catch (err) {
    console.error('recommendations error:', err);
    res.status(500).json({ error: 'Failed to fetch recommendations' });
  }
});

// GET /api/poster?path=/library/metadata/...
// Proxies Plex poster through server — browser never sees Plex token
router.get('/poster', async (req, res) => {
  const { path: posterPath } = req.query;

  // Security: only allow /library/ paths to prevent SSRF
  if (!posterPath || !posterPath.startsWith('/library/')) {
    return res.status(400).json({ error: 'Invalid poster path' });
  }

  try {
    const url = `${plexService.PLEX_URL}${posterPath}?X-Plex-Token=${plexService.PLEX_TOKEN}`;
    const imgRes = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!imgRes.ok) {
      return res.status(imgRes.status).send('Poster not found');
    }
    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const buffer = await imgRes.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('poster proxy error:', err);
    res.status(500).send('Failed to fetch poster');
  }
});

// GET /api/watchlist
router.get('/watchlist', async (req, res) => {
  try {
    const { token: userToken } = req.session.plexUser;
    const watchlist = await plexService.getWatchlist(userToken);
    res.json(watchlist);
  } catch (err) {
    console.error('watchlist get error:', err);
    res.status(500).json({ error: 'Failed to fetch watchlist' });
  }
});

// POST /api/watchlist/add
router.post('/watchlist/add', async (req, res) => {
  const { ratingKey } = req.body;
  if (!ratingKey) return res.status(400).json({ error: 'ratingKey required' });

  // Security: ratingKey must be numeric
  if (!/^\d+$/.test(String(ratingKey))) {
    return res.status(400).json({ error: 'Invalid ratingKey' });
  }

  try {
    const { token: userToken } = req.session.plexUser;
    await plexService.addToWatchlist(userToken, ratingKey);
    res.json({ success: true });
  } catch (err) {
    console.error('watchlist add error:', err);
    res.status(500).json({ error: 'Failed to add to watchlist' });
  }
});

// POST /api/watchlist/remove
router.post('/watchlist/remove', async (req, res) => {
  const { playlistId, playlistItemId } = req.body;
  if (!playlistId || !playlistItemId) {
    return res.status(400).json({ error: 'playlistId and playlistItemId required' });
  }

  // Security: must be numeric IDs
  if (!/^\d+$/.test(String(playlistId)) || !/^\d+$/.test(String(playlistItemId))) {
    return res.status(400).json({ error: 'Invalid playlist IDs' });
  }

  try {
    const { token: userToken } = req.session.plexUser;
    await plexService.removeFromWatchlist(userToken, playlistId, playlistItemId);
    res.json({ success: true });
  } catch (err) {
    console.error('watchlist remove error:', err);
    res.status(500).json({ error: 'Failed to remove from watchlist' });
  }
});

// POST /api/dismiss — body: { ratingKey }
router.post('/dismiss', (req, res) => {
  const { ratingKey } = req.body;
  if (!ratingKey) return res.status(400).json({ error: 'ratingKey required' });
  if (!/^\d+$/.test(String(ratingKey))) {
    return res.status(400).json({ error: 'Invalid ratingKey' });
  }

  const { id: userId } = req.session.plexUser;
  db.addDismissal(userId, ratingKey);
  recommender.invalidateUserCache(userId);
  res.json({ success: true });
});

// DELETE /api/dismiss — body: { ratingKey }
router.delete('/dismiss', (req, res) => {
  const { ratingKey } = req.body;
  if (!ratingKey) return res.status(400).json({ error: 'ratingKey required' });
  if (!/^\d+$/.test(String(ratingKey))) {
    return res.status(400).json({ error: 'Invalid ratingKey' });
  }

  const { id: userId } = req.session.plexUser;
  db.removeDismissal(userId, ratingKey);
  res.json({ success: true });
});

module.exports = router;
