import { Router } from 'express';

/** Bonus: simple analytics for the admin dashboard. */
export function adminRoutes(db, { requireAuth, requireAdmin }) {
  const router = Router();

  router.get('/analytics', requireAuth, requireAdmin, (_req, res) => {
    const one = (sql) => db.prepare(sql).get();
    const now = new Date().toISOString();

    const totals = {
      users: one("SELECT COUNT(*) AS n FROM users WHERE role = 'user'").n,
      events: one('SELECT COUNT(*) AS n FROM events').n,
      upcoming_events: db.prepare('SELECT COUNT(*) AS n FROM events WHERE date_time >= ?').get(now).n,
      registrations: one('SELECT COUNT(*) AS n FROM registrations').n,
    };

    const perEvent = db
      .prepare(
        `SELECT e.id, e.title, e.category, e.date_time, e.capacity,
                COUNT(r.id) AS registered,
                ROUND(100.0 * COUNT(r.id) / e.capacity, 1) AS fill_percent
         FROM events e LEFT JOIN registrations r ON r.event_id = e.id
         GROUP BY e.id ORDER BY registered DESC, e.date_time ASC LIMIT 10`,
      )
      .all();

    const byCategory = db
      .prepare(
        `SELECT e.category, COUNT(DISTINCT e.id) AS events, COUNT(r.id) AS registrations
         FROM events e LEFT JOIN registrations r ON r.event_id = e.id
         GROUP BY e.category COLLATE NOCASE ORDER BY registrations DESC`,
      )
      .all();

    res.json({ data: { totals, top_events: perEvent, by_category: byCategory } });
  });

  return router;
}
