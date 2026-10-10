import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { unauthorized, forbidden } from '../errors.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

function readToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

/** Build auth middlewares bound to a database. Users are re-loaded so deleted/demoted users lose access immediately. */
export function createAuth(db) {
  const findUser = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?');

  function load(req) {
    const token = readToken(req);
    if (!token) return null;
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw unauthorized('Invalid or expired token');
    }
    const user = findUser.get(payload.sub);
    if (!user) throw unauthorized('User no longer exists');
    return user;
  }

  const requireAuth = (req, _res, next) => {
    try {
      const user = load(req);
      if (!user) throw unauthorized();
      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };

  /** Attaches req.user when a valid token is sent, but never rejects. */
  const optionalAuth = (req, _res, next) => {
    try {
      req.user = load(req) || null;
    } catch {
      req.user = null;
    }
    next();
  };

  const requireAdmin = (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (req.user.role !== 'admin') return next(forbidden('Admin access required'));
    next();
  };

  return { requireAuth, optionalAuth, requireAdmin };
}
