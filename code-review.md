# Diskovarr — Code Review

> Reviewed: 2026-03-07

**Overall:** Clean, well-structured self-hosted app. The architecture is sensible, the code is readable, and several security concerns (SQL injection, XSS, SSRF, timing attacks) have already been handled correctly. Below are the remaining findings.

---

## Security

### 1. Plex tokens in URL query params (`plex.js:107`, `163–165`, etc.)

The `X-Plex-Token` appears in URL query strings (e.g., `?X-Plex-Token=${PLEX_TOKEN}`), which means it can appear in server access logs, browser history, and `Referer` headers. Plex's own API requires this pattern so it's unavoidable on many calls, but some internal calls (like `syncLibrarySection`) include it in the URL unnecessarily when the header already carries it.

---

## Code Quality

### 2. `getLibraryItems` called twice per discover request (`api.js:154–159`)

The movies and TV sections are fetched separately by the recommendations endpoint and the discover genres endpoint, even though both are already cached. The cost is low (cache hit), but the calls could share data within a single request.

---

## Missing Safeguards

### 3. No rate limiting on auth endpoints

`POST /auth/check-pin` and `POST /admin/login` have no rate limiting. For a self-hosted tool on a trusted network this is low risk, but easy to add with [`express-rate-limit`](https://github.com/express-rate-limit/express-rate-limit).

### 4. `APP_URL` not documented in `.env.example` (`pages.js:39`)

`process.env.APP_URL` is used to build the Plex auth redirect URL but is not listed in `.env.example`. New users relying on the fallback (`req.protocol + '://' + req.get('host')`) behind a reverse proxy may get unexpected behavior.

---

## What's Done Well

| Area | Detail |
|---|---|
| **Timing-safe password check** | `admin.js:43–46` correctly uses `crypto.timingSafeEqual` |
| **SSRF protection on poster proxy** | `api.js:28–30` only allows `/library/` paths |
| **Input validation** | `ratingKey` validated as `/^\d+$/` everywhere it's accepted from user input |
| **Token isolation** | Plex tokens stay server-side; the browser never sees them |
| **Parameterized SQL** | All queries use prepared statements — no injection risk |
| **Zero native dependencies** | Migration to `node:sqlite` eliminates `better-sqlite3` and `connect-sqlite3`; the custom `SQLiteStore` in `server.js` is a clean, dependency-free replacement |
| **Concurrent sync deduplication** | In-flight promise maps prevent parallel fetches per section/user |
| **Graceful stale fallback** | Serves cached DB data if a live Plex sync fails |
| **XSS prevention** | `escHtml()` in `app.js` uses `createTextNode`, avoiding `innerHTML` injection |
| **Recommendation algorithm** | Tiered sampling, signal ranking, and diversity injection are all well-designed for the use case |
