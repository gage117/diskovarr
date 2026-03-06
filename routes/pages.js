const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const db = require('../db/database');

// Dynamic theme CSS — injects the current accent color as a CSS variable override
router.get('/theme.css', (req, res) => {
  const color = db.getThemeColor();
  // Derive a dimmed rgba version for backgrounds
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const css = `:root {
  --accent: ${color};
  --accent-dim: rgba(${r}, ${g}, ${b}, 0.15);
  --accent-border: rgba(${r}, ${g}, ${b}, 0.4);
}\n`;
  res.setHeader('Content-Type', 'text/css');
  res.setHeader('Cache-Control', 'no-store');
  res.send(css);
});

// Login page
router.get('/login', (req, res) => {
  if (req.session && req.session.plexUser) {
    return res.redirect('/');
  }
  const error = req.query.error || null;
  res.render('login', { error });
});

// Home page — requires auth
router.get('/', requireAuth, (req, res) => {
  const { id: userId, username, thumb } = req.session.plexUser;
  res.render('home', {
    userId,
    username,
    thumb,
  });
});

module.exports = router;
