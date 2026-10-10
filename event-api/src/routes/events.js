import { Router } from 'express';
import { badRequest, conflict, notFound } from '../errors.js';
import {
  parse,
  parseId,
  createEventSchema,
  updateEventSchema,
  listEventsQuerySchema,
} from '../validation.js';

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function eventRoutes(db, { requireAuth, optionalAuth, requireAdmin }) {
  const router = Router();

  const BASE = `
    SELECT e.*,
      (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id) AS registered_count
    FROM events e`;

  const decorate = (row, userId) => {
    if (!row) return row;
    const out = {
      ...row,
      spots_left: Math.max(row.capacity - row.registered_count, 0),
      is_full: row.registered_count >= row.capacity,
    };
    if (userId) {
      out.is_registered = Boolean(
        db.prepare('SELECT 1 FROM registrations WHERE user_id = ? AND event_id = ?').get(userId, row.id),
      );
    }
    return out;
  };

  const getEvent = db.prepare(`${BASE} WHERE e.id = ?`);
  const countFor = db.prepare('SELECT COUNT(*) AS n FROM registrations WHERE event_id = ?');

  // ---- Browse / search / filter (public) -------------------------------------
  router.get('/', optionalAuth, (req, res) => {
    const q = parse(listEventsQuerySchema, req.query);
    const where = [];
    const params = [];

    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      where.push(`(e.title LIKE ? ESCAPE '\\' OR e.description LIKE ? ESCAPE '\\' OR e.venue LIKE ? ESCAPE '\\')`);
      params.push(like, like, like);
    }
    if (q.category) {
      where.push('e.category = ? COLLATE NOCASE');
      params.push(q.category);
    }
    if (q.from) {
      where.push('e.date_time >= ?');
      params.push(q.from);
    }
    if (q.to) {
      where.push('e.date_time <= ?');
      params.push(q.to);
    }
    if (q.upcoming === 'true') {
      where.push('e.date_time >= ?');
      params.push(new Date().toISOString());
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const having = q.available === 'true' ? 'WHERE registered_count < capacity' : '';

    const order = { date_asc: 'date_time ASC', date_desc: 'date_time DESC', newest: 'created_at DESC' }[q.sort];

    const inner = `${BASE} ${whereSql}`;
    const total = db
      .prepare(`SELECT COUNT(*) AS n FROM (${inner}) ${having}`)
      .get(...params).n;
    const rows = db
      .prepare(`SELECT * FROM (${inner}) ${having} ORDER BY ${order}, id ASC LIMIT ? OFFSET ?`)
      .all(...params, q.limit, (q.page - 1) * q.limit);

    res.json({
      data: rows.map((r) => decorate(r, req.user?.id)),
      pagination: {
        page: q.page,
        limit: q.limit,
        total,
        total_pages: Math.max(Math.ceil(total / q.limit), 1),
      },
    });
  });

  router.get('/categories', (_req, res) => {
    const rows = db.prepare('SELECT DISTINCT category FROM events ORDER BY category COLLATE NOCASE').all();
    res.json({ data: rows.map((r) => r.category) });
  });

  router.get('/:id', optionalAuth, (req, res) => {
    const id = parseId(req.params.id, 'event id');
    const event = getEvent.get(id);
    if (!event) throw notFound('Event not found');
    res.json({ data: decorate(event, req.user?.id) });
  });

  // ---- Admin CRUD ------------------------------------------------------------
  router.post('/', requireAuth, requireAdmin, (req, res) => {
    const e = parse(createEventSchema, req.body);
    const info = db
      .prepare(
        `INSERT INTO events (title, description, date_time, venue, capacity, category, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(e.title, e.description, e.date_time, e.venue, e.capacity, e.category, req.user.id);
    res.status(201).json({ data: decorate(getEvent.get(Number(info.lastInsertRowid))) });
  });

  router.put('/:id', requireAuth, requireAdmin, (req, res) => {
    const id = parseId(req.params.id, 'event id');
    const changes = parse(updateEventSchema, req.body);

    // Transaction keeps the capacity check and the update atomic.
    const update = db.transaction(() => {
      if (!getEvent.get(id)) throw notFound('Event not found');
      if (changes.capacity !== undefined) {
        const registered = countFor.get(id).n;
        if (changes.capacity < registered) {
          throw conflict(
            `Capacity cannot be lower than the ${registered} existing registration(s). Remove registrations first.`,
          );
        }
      }
      const keys = Object.keys(changes);
      const sets = keys.map((k) => `${k} = ?`).join(', ');
      db.prepare(`UPDATE events SET ${sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(
        ...keys.map((k) => changes[k]),
        id,
      );
    });
    update();
    res.json({ data: decorate(getEvent.get(id)) });
  });

  router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
    const id = parseId(req.params.id, 'event id');
    const info = db.prepare('DELETE FROM events WHERE id = ?').run(id); // registrations cascade
    if (info.changes === 0) throw notFound('Event not found');
    res.status(204).end();
  });

  // ---- Registration (authenticated users) ------------------------------------
  const insertReg = db.prepare('INSERT INTO registrations (user_id, event_id) VALUES (?, ?)');
  const findReg = db.prepare('SELECT * FROM registrations WHERE user_id = ? AND event_id = ?');

  router.post('/:id/register', requireAuth, (req, res) => {
    const eventId = parseId(req.params.id, 'event id');

    // better-sqlite3 transactions are synchronous and serialised, so the
    // duplicate check, capacity check and insert can't interleave with another request.
    const register = db.transaction(() => {
      const event = getEvent.get(eventId);
      if (!event) throw notFound('Event not found');
      if (new Date(event.date_time) < new Date()) throw badRequest('This event has already taken place');
      if (findReg.get(req.user.id, eventId)) throw conflict('You are already registered for this event');
      if (event.registered_count >= event.capacity) throw conflict('This event is full');
      const info = insertReg.run(req.user.id, eventId);
      return Number(info.lastInsertRowid);
    });

    const regId = register();
    res.status(201).json({
      data: {
        registration: db.prepare('SELECT * FROM registrations WHERE id = ?').get(regId),
        event: decorate(getEvent.get(eventId), req.user.id),
      },
    });
  });

  router.delete('/:id/register', requireAuth, (req, res) => {
    const eventId = parseId(req.params.id, 'event id');
    if (!getEvent.get(eventId)) throw notFound('Event not found');
    const info = db
      .prepare('DELETE FROM registrations WHERE user_id = ? AND event_id = ?')
      .run(req.user.id, eventId);
    if (info.changes === 0) throw notFound('You are not registered for this event');
    res.json({ data: decorate(getEvent.get(eventId), req.user.id) });
  });

  // ---- Attendee list (admin) -------------------------------------------------
  router.get('/:id/registrations', requireAuth, requireAdmin, (req, res) => {
    const eventId = parseId(req.params.id, 'event id');
    if (!getEvent.get(eventId)) throw notFound('Event not found');
    const rows = db
      .prepare(
        `SELECT r.id, r.created_at, u.id AS user_id, u.name, u.email
         FROM registrations r JOIN users u ON u.id = r.user_id
         WHERE r.event_id = ? ORDER BY r.created_at ASC`,
      )
      .all(eventId);
    res.json({ data: rows, total: rows.length });
  });

  return router;
}
