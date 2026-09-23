const crypto = require('node:crypto');

function ensureToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

function expose(req, res, next) {
  res.locals.csrfToken = ensureToken(req);
  next();
}

function verify(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const expected = ensureToken(req);
  const provided = String(req.body?._csrf || req.headers['x-csrf-token'] || '');
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).render('error', { title: 'Permintaan ditolak', error: 'Token keamanan tidak valid. Muat ulang halaman dan coba lagi.' });
  }
  next();
}

module.exports = { expose, verify };
