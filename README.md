# Diskovarr

Personalized Plex content recommendations powered by your watch history.

## Features

- **Plex OAuth sign-in** — users authenticate with their own Plex account
- **Personalized scoring** — recommendations weighted by genre, director, actor, and decade preferences built from your Tautulli watch history
- **4 sections** — Top Picks, Movies, TV Shows, Anime
- **Diskovarr Watchlist** — private Plex playlist, separate from the Plex watchlist (which triggers downloads)
- **Dismiss** — hide items you're not interested in (persisted in SQLite)
- **Dark Netflix-style UI** — Plex gold accent, shimmer skeleton loading, card hover effects
- **Poster proxy** — all Plex API calls go through the server; tokens never exposed to browser

## Requirements

- Node.js >= 20
- A running Plex Media Server
- Tautulli (for watch history)

## Setup

```bash
git clone https://github.com/Lebbitheplow/diskovarr
cd diskovarr
cp .env.example .env
# Edit .env with your values
npm install
npm start
```

Open `http://your-server:3232` and sign in with your Plex account.

## Configuration

Copy `.env.example` to `.env` and fill in the values:

| Variable | Description |
|---|---|
| `PLEX_URL` | Local URL of your Plex server (e.g. `http://192.168.1.x:32400`) |
| `PLEX_TOKEN` | Your Plex admin token (used for library fetching and poster proxy) |
| `PLEX_SERVER_ID` | Plex machine identifier (from Plex preferences) |
| `PLEX_SERVER_NAME` | Display name for your server |
| `PLEX_MOVIES_SECTION_ID` | Library section ID for movies (default: `1`) |
| `PLEX_TV_SECTION_ID` | Library section ID for TV/Anime (default: `2`) |
| `TAUTULLI_URL` | URL of your Tautulli instance |
| `TAUTULLI_API_KEY` | Tautulli API key |
| `SESSION_SECRET` | Random string for session signing |
| `PORT` | Port to run on (default: `3232`) |

### Finding your Plex Machine ID

Go to `http://your-plex:32400/identity` — the `machineIdentifier` field is your `PLEX_SERVER_ID`.

### Finding Tautulli User IDs

Diskovarr uses the Plex OAuth user ID which matches Tautulli's user ID — no extra configuration needed.

## How Recommendations Work

1. **Profile building** — fetches your last 1,000 movie and 2,000 episode watches from Tautulli
2. **Weighting** — recent watches (top 50) get a 1.5× multiplier; fully-watched items get 1.3×
3. **Scoring** — each unwatched library item is scored:
   - Genre overlap: up to 40 points
   - Director match: up to 25 points
   - Actor overlap: up to 20 points
   - Decade preference: up to 10 points
   - Rating bonus: +5 if audience rating ≥ 8.0
   - New addition bonus: +3 if added to Plex within 7 days
4. **Anime detection** — items with the "Anime" genre tag in the TV library are separated into their own section
5. **Caching** — library data cached 2 hours; recommendations cached 30 minutes per user

## Development

```bash
npm run dev    # Start with --watch (auto-restart on file changes)
```

## License

MIT
