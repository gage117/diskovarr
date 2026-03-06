const PLEX_URL = process.env.PLEX_URL;
const PLEX_TOKEN = process.env.PLEX_TOKEN;
const PLEX_SERVER_ID = process.env.PLEX_SERVER_ID;
const MOVIES_SECTION = process.env.PLEX_MOVIES_SECTION_ID || '1';
const TV_SECTION = process.env.PLEX_TV_SECTION_ID || '2';

const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours
const libraryCache = new Map(); // sectionId -> { data, fetchedAt }

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
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
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
  };
}

async function fetchSection(sectionId) {
  const cached = libraryCache.get(sectionId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.data;
  }

  console.log(`Fetching library section ${sectionId}...`);
  const json = await plexFetch(
    `/library/sections/${sectionId}/all?X-Plex-Container-Size=99999&X-Plex-Token=${PLEX_TOKEN}`
  );

  const videos = json.MediaContainer?.Metadata || [];
  const items = videos.map(parseMediaItem);

  libraryCache.set(sectionId, { data: items, fetchedAt: Date.now() });
  console.log(`Cached ${items.length} items for section ${sectionId}`);
  return items;
}

async function getLibraryItems(sectionId) {
  return fetchSection(String(sectionId));
}

async function warmCache() {
  await fetchSection(MOVIES_SECTION);
  await fetchSection(TV_SECTION);
}

function invalidateCache(sectionId) {
  if (sectionId) {
    libraryCache.delete(String(sectionId));
  } else {
    libraryCache.clear();
  }
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
async function getDiskovarrPlaylist(userToken) {
  try {
    const json = await plexFetch(
      `/playlists/all?playlistType=video&X-Plex-Token=${userToken}`,
      userToken
    );
    const playlists = json.MediaContainer?.Metadata || [];
    const playlist = playlists.find(p => p.title === 'Diskovarr Watchlist');
    if (!playlist) return null;

    const itemsJson = await plexFetch(
      `/playlists/${playlist.ratingKey}/items?X-Plex-Token=${userToken}`,
      userToken
    );
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

async function getWatchlist(userToken) {
  const playlist = await getDiskovarrPlaylist(userToken);
  return playlist || { playlistId: null, items: [] };
}

async function addToWatchlist(userToken, ratingKey) {
  const existing = await getDiskovarrPlaylist(userToken);
  const uri = `server://${PLEX_SERVER_ID}/com.plexapp.plugins.library/library/metadata/${ratingKey}`;

  if (!existing) {
    // Create new playlist
    const createUrl = `${PLEX_URL}/playlists?type=video&title=Diskovarr%20Watchlist&smart=0&uri=${encodeURIComponent(uri)}&X-Plex-Token=${userToken}`;
    const res = await fetch(createUrl, {
      method: 'POST',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Failed to create playlist: ${res.status}`);
    return res.json();
  }

  // Add to existing playlist
  const putUrl = `${PLEX_URL}/playlists/${existing.playlistId}/items?uri=${encodeURIComponent(uri)}&X-Plex-Token=${userToken}`;
  const res = await fetch(putUrl, {
    method: 'PUT',
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Failed to add to playlist: ${res.status}`);
  return res.json();
}

async function removeFromWatchlist(userToken, playlistId, playlistItemId) {
  const url = `${PLEX_URL}/playlists/${playlistId}/items/${playlistItemId}?X-Plex-Token=${userToken}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'Accept': 'application/json' },
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
  warmCache,
  invalidateCache,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  getDeepLink,
  PLEX_URL,
  PLEX_TOKEN,
};
