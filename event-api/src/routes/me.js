import { Router } from 'express';
import QRCode from 'qrcode';
import { forbidden, notFound } from '../errors.js';
import { parseId } from '../validation.js';

/** Routes about the logged-in user's own registrations (+ QR ticket bonus). */
export function meRoutes(db, { requireAuth }) {
  const router = Router();

  router.get('/registrations', requireAuth, (req, res) => {
    const rows = db
      .prepare(
        `SELECT r.id AS registration_id, r.created_at AS registered_at,
                e.id, e.title, e.description, e.date_time, e.venue, e.capacity, e.category,
                (SELECT COUNT(*) FROM registrations x WHERE x.event_id = e.id) AS registered_count
         FROM registrations r JOIN events e ON e.id = r.event_id
         WHERE r.user_id = ? ORDER BY e.date_time ASC`,
      )
      .all(req.user.id);
    res.json({ data: rows, total: rows.length });
  });

  // Bonus: QR-code ticket (PNG) for a registration — owner or admin only.
  router.get('/registrations/:id/qr', requireAuth, async (req, res, next) => {
    try {
      const id = parseId(req.params.id, 'registration id');
      const reg = db.prepare('SELECT * FROM registrations WHERE id = ?').get(id);
      if (!reg) throw notFound('Registration not found');
      if (reg.user_id !== req.user.id && req.user.role !== 'admin') throw forbidden();
      const payload = JSON.stringify({ registration: reg.id, event: reg.event_id, user: reg.user_id });
      const png = await QRCode.toBuffer(payload, { width: 320, margin: 2 });
      res.type('image/png').send(png);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
