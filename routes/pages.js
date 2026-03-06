const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');

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
