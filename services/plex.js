const db = require('../db/database');
const tautulliService = require('./tautulli');

const PLEX_URL = process.env.PLEX_URL;
const PLEX_TOKEN = process.env.PLEX_TOKEN;
const PLEX_SERVER_ID = process.env.PLEX_SERVER_ID;
const MOVIES_SECTION = process.env.PLEX_MOVIES_SECTION_ID || '1';
const TV_SECTION = process.env.PLEX_TV_SECTION_ID || '2';

// In-memory L1 cache on top of DB — avoids repeat DB reads within same cycle
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours
const libraryCache = new Map(); // sectionId -> { data, fetchedAt }

// Per-user watched sync: userId -> Promise (prevents parallel syncs)
const watchedSyncInProgress = new Map();
const WATCHED_SYNC_TTL = 30 * 60; // 30 minutes (seconds)

// Per-section library sync: sectionId -> Promise (prevents parallel fetches)
const libSyncInProgress = new Map();

const PLEX_HEADERS = {
  'Accept': 'application/json',
  'X-Plex-Token': PLEX_TOKEN,
};

async function plexFetch(path, token) {
  const url = `${PLEX_URL}${path}`;
  const headers = { ...PLEX_HEADERS };
  if (token && token !== PLEX_TOKEN) {
    headers['X-Plex-Token'] = token;
  }
  const timeout = path.includes('/sections/') ? 180000 : 15000;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`Plex API error ${res.status} for ${path}`);
  return res.json();
}

function parseMediaItem(video) {
  const genres = (video.Genre || []).map(g => g.tag);
  const directors = (video.Director || []).map(d => d.tag);
  const cast = (video.Role || []).slice(0, 10).map(r => r.tag);
  const year = video.year || parseInt((video.originallyAvailableAt || '').slice(0, 4)) || 0;
  return {
    ratingKey: String(video.ratingKey),
    title: video.title,
    year,
    thumb: video.thumb || null,
    type: video.type, // 'movie' or 'show'
    genres,
    directors,
    cast,
    audienceRating: parseFloat(video.audienceRating) || 0,
    contentRating: video.contentRating || '',
    addedAt: video.addedAt || 0,
    summary: video.summary || '',
    rating: parseFloat(video.rating) || 0,
    ratingImage: video.ratingImage || '',
    audienceRatingImage: video.audienceRatingImage || '',
    studio: video.studio || '',
  };
}

async function fetchSection(sectionId) {
  const cached = libraryCache.get(sectionId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.data;
  }

  // Try DB first — use it if synced recently enough
  const dbSyncTime = db.getSyncTime(`library_${sectionId}`);
  const dbAge = Math.floor(Date.now() / 1000) - dbSyncTime;
  if (dbSyncTime > 0 && dbAge < 7200) {
    const items = db.getLibraryItemsFromDb(sectionId);
    if (items.length > 0) {
      libraryCache.set(sectionId, { data: items, fetchedAt: Date.now() });
      console.log(`Loaded ${items.length} items for section ${sectionId} from DB (age: ${Math.round(dbAge/60)}m)`);
      return items;
    }
  }

  // Deduplicate concurrent syncs — only one fetch per sectionId at a time
  if (!libSyncInProgress.has(sectionId)) {
    const p = syncLibrarySection(sectionId)
      .catch(err => {
        const stale = db.getLibraryItemsFromDb(sectionId);
        if (stale.length > 0) {
          console.warn(`Sync failed for section ${sectionId} (${err.message}), serving ${stale.length} stale items from DB`);
          libraryCache.set(sectionId, { data: stale, fetchedAt: Date.now() - CACHE_TTL + 5 * 60 * 1000 }); // retry in 5 min
          return stale;
        }
        throw err;
      })
      .finally(() => libSyncInProgress.delete(sectionId));
    libSyncInProgress.set(sectionId, p);
  }
  return libSyncInProgress.get(sectionId);
}

async function syncLibrarySection(sectionId) {
  console.log(`Syncing library section ${sectionId} from Plex...`);
  const json = await plexFetch(
    `/library/sections/${sectionId}/all?X-Plex-Container-Size=99999&X-Plex-Token=${PLEX_TOKEN}`
  );

  const videos = json.MediaContainer?.Metadata || [];
  const items = videos.map(v => ({ ...parseMediaItem(v), sectionId }));

  // Write to DB
  db.upsertManyItems(items);
  db.setSyncTime(`library_${sectionId}`);

  // Update in-memory cache
  libraryCache.set(sectionId, { data: items, fetchedAt: Date.now() });
  console.log(`Synced ${items.length} items for section ${sectionId} to DB`);
  return items;
}

async function getLibraryItems(sectionId) {
  return fetchSection(String(sectionId));
}

async function warmCache() {
  await Promise.all([fetchSection(MOVIES_SECTION), fetchSection(TV_SECTION)]);
}

function invalidateCache(sectionId) {
  if (sectionId) {
    libraryCache.delete(String(sectionId));
  } else {
    libraryCache.clear();
  }
}

/**
 * Sync watched status for a user from Tautulli into the local DB.
 * Tautulli has per-user play history — accurate for both the server owner
 * and Plex Friends without needing the admin Plex token + accountID trick.
 * Also pulls star ratings from Plex for recommendation weighting.
 */
async function syncUserWatched(userId, userToken) {
  const syncKey = `watched_${userId}`;
  try {
    // Tautulli gives us accurate per-user history:
    //   - movies watched ≥90% completion
    //   - shows where ANY episode was watched (prevents re-recommending started shows)
    const [movieKeys, showKeys] = await Promise.all([
      tautulliService.getWatchedMovieKeys(userId),
      tautulliService.getWatchedShowKeys(userId),
    ]);

    const watchedKeys = new Set([...movieKeys, ...showKeys]);
    db.replaceWatchedBatch(userId, watchedKeys);
    db.setSyncTime(syncKey);

    // Also extract Plex star ratings using admin token + accountID for recommendation weighting
    const safeFetch = (url, timeoutMs) =>
      fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
        .then(r => r.ok ? r.json() : { MediaContainer: {} })
        .catch(() => ({ MediaContainer: {} }));

    const moviesJson = await safeFetch(
      `${PLEX_URL}/library/sections/${MOVIES_SECTION}/all?unwatched=0&accountID=${userId}&X-Plex-Container-Size=99999&X-Plex-Token=${PLEX_TOKEN}`,
      45000
    );
    const ratedItems = [];
    for (const item of (moviesJson.MediaContainer?.Metadata || [])) {
      if (item.userRating) {
        ratedItems.push({ ratingKey: String(item.ratingKey), userRating: parseFloat(item.userRating) });
      }
    }
    if (ratedItems.length > 0) {
      db.upsertUserRatings(userId, ratedItems);
      console.log(`Stored ${ratedItems.length} user ratings for user ${userId}`);
    }

    console.log(`Synced ${watchedKeys.size} watched items for user ${userId} via Tautulli (movies: ${movieKeys.size}, shows: ${showKeys.size})`);
  } catch (err) {
    console.warn(`syncUserWatched(${userId}) error:`, err.message);
  } finally {
    watchedSyncInProgress.delete(userId);
  }
}

/**
 * Get watched keys from DB for a user.
 * Triggers a background sync if data is stale (>30 min) or missing.
 * Returns whatever is in DB immediately — never blocks recommendations.
 */
async function getWatchedKeys(userId, userToken) {
  const syncKey = `watched_${userId}`;
  const lastSync = db.getSyncTime(syncKey);
  const age = Math.floor(Date.now() / 1000) - lastSync;
  const hasData = lastSync > 0;

  if (!hasData) {
    // First time for this user — sync now and wait (first request only)
    if (!watchedSyncInProgress.has(userId)) {
      const p = syncUserWatched(userId, userToken);
      watchedSyncInProgress.set(userId, p);
      await p;
    } else {
      await watchedSyncInProgress.get(userId);
    }
  } else if (age > WATCHED_SYNC_TTL) {
    // Stale — return current DB data immediately, refresh in background
    if (!watchedSyncInProgress.has(userId)) {
      const p = syncUserWatched(userId, userToken);
      watchedSyncInProgress.set(userId, p);
      // Don't await — let it run in background
    }
  }

  return db.getWatchedKeysFromDb(userId);
}

// Build a lookup map by ratingKey for fast scoring
async function getLibraryMap() {
  const [movies, tv] = await Promise.all([
    getLibraryItems(MOVIES_SECTION),
    getLibraryItems(TV_SECTION),
  ]);
  const map = new Map();
  for (const item of [...movies, ...tv]) {
    map.set(item.ratingKey, item);
  }
  return map;
}

// Watchlist / Playlist management
// serverUrl: relay/external URL stored in session for this user; falls back to PLEX_URL
async function getDiskovarrPlaylist(userToken, serverUrl) {
  const base = serverUrl || PLEX_URL;
  try {
    const res = await fetch(`${base}/playlists/all?playlistType=video&X-Plex-Token=${userToken}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Plex API error ${res.status}`);
    const json = await res.json();

    const playlists = json.MediaContainer?.Metadata || [];
    const playlist = playlists.find(p => p.title === 'Diskovarr');
    if (!playlist) return null;

    const itemsRes = await fetch(`${base}/playlists/${playlist.ratingKey}/items?X-Plex-Token=${userToken}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!itemsRes.ok) throw new Error(`Plex API error ${itemsRes.status}`);
    const itemsJson = await itemsRes.json();
    const items = (itemsJson.MediaContainer?.Metadata || []).map(i => ({
      ratingKey: String(i.ratingKey),
      playlistItemId: String(i.playlistItemId),
    }));

    return {
      playlistId: String(playlist.ratingKey),
      items,
    };
  } catch (err) {
    console.warn('getDiskovarrPlaylist error:', err.message);
    return null;
  }
}

async function getWatchlist(userToken, serverUrl) {
  const playlist = await getDiskovarrPlaylist(userToken, serverUrl);
  return playlist || { playlistId: null, items: [] };
}

async function addToWatchlist(userToken, ratingKey, serverUrl) {
  const base = serverUrl || PLEX_URL;
  const existing = await getDiskovarrPlaylist(userToken, serverUrl);
  const uri = `server://${PLEX_SERVER_ID}/com.plexapp.plugins.library/library/metadata/${ratingKey}`;

  if (!existing) {
    const createUrl = `${base}/playlists?type=video&title=Diskovarr&smart=0&uri=${encodeURIComponent(uri)}&X-Plex-Token=${userToken}`;
    const res = await fetch(createUrl, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Failed to create playlist: ${res.status}`);
    return res.json();
  }

  const putUrl = `${base}/playlists/${existing.playlistId}/items?uri=${encodeURIComponent(uri)}&X-Plex-Token=${userToken}`;
  const res = await fetch(putUrl, {
    method: 'PUT',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Failed to add to playlist: ${res.status}`);
  return res.json();
}

async function removeFromWatchlist(userToken, playlistId, playlistItemId, serverUrl) {
  const base = serverUrl || PLEX_URL;
  const url = `${base}/playlists/${playlistId}/items/${playlistItemId}?X-Plex-Token=${userToken}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Failed to remove from playlist: ${res.status}`);
  return true;
}

function getDeepLink(ratingKey) {
  return `https://app.plex.tv/desktop#!/server/${PLEX_SERVER_ID}/details?key=/library/metadata/${ratingKey}`;
}

module.exports = {
  getLibraryItems,
  getLibraryMap,
  getWatchedKeys,
  syncUserWatched,
  syncLibrarySection,
  warmCache,
  invalidateCache,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  getDeepLink,
  PLEX_URL,
  PLEX_TOKEN,
  MOVIES_SECTION,
  TV_SECTION,
};
