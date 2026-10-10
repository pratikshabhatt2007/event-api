import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { conflict, unauthorized } from '../errors.js';
import { parse, registerSchema, loginSchema } from '../validation.js';
import { signToken } from '../middleware/auth.js';

export function authRoutes(db, { requireAuth }, authLimiter) {
  const router = Router();

  const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
  const insertUser = db.prepare('INSERT INTO users (name, email, password) VALUES (?, ?, ?)');
  const findPublic = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?');

  // Public sign-up always creates a normal user; admins are provisioned via env/seed.
  router.post('/register', authLimiter, (req, res) => {
    const { name, email, password } = parse(registerSchema, req.body);
    if (findByEmail.get(email)) throw conflict('An account with this email already exists');

    const hash = bcrypt.hashSync(password, 10);
    const info = insertUser.run(name, email, hash);
    const user = findPublic.get(Number(info.lastInsertRowid));
    res.status(201).json({ user, token: signToken(user) });
  });

  router.post('/login', authLimiter, (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const row = findByEmail.get(email);
    // Same error for unknown email / wrong password so accounts can't be enumerated.
    if (!row || !bcrypt.compareSync(password, row.password)) {
      throw unauthorized('Invalid email or password');
    }
    const user = findPublic.get(row.id);
    res.json({ user, token: signToken(user) });
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}
