function requireAuth(req, res, next) {
  if (req.session && req.session.plexUser) {
    return next();
  }
  if (req.path.startsWith('/api/') || req.baseUrl.startsWith('/api')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.redirect('/login');
}

module.exports = requireAuth;
