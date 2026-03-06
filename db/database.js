const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'diskovarr.db'));

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS dismissals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plex_user_id TEXT NOT NULL,
    rating_key TEXT NOT NULL,
    dismissed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(plex_user_id, rating_key)
  );
  CREATE INDEX IF NOT EXISTS idx_dismissals_user ON dismissals(plex_user_id);
`);

const stmtAdd = db.prepare(
  'INSERT OR IGNORE INTO dismissals (plex_user_id, rating_key) VALUES (?, ?)'
);
const stmtGet = db.prepare(
  'SELECT rating_key FROM dismissals WHERE plex_user_id = ?'
);
const stmtRemove = db.prepare(
  'DELETE FROM dismissals WHERE plex_user_id = ? AND rating_key = ?'
);

function addDismissal(userId, ratingKey) {
  stmtAdd.run(String(userId), String(ratingKey));
}

function getDismissals(userId) {
  const rows = stmtGet.all(String(userId));
  return new Set(rows.map(r => r.rating_key));
}

function removeDismissal(userId, ratingKey) {
  stmtRemove.run(String(userId), String(ratingKey));
}

module.exports = { addDismissal, getDismissals, removeDismissal };
