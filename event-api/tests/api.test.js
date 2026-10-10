process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, seedAdmin } from '../src/db.js';
import { createApp } from '../src/app.js';

let server, base, db;
let adminToken, userToken, user2Token;

const future = (days) => new Date(Date.now() + days * 864e5).toISOString();

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : null;
  return { status: res.status, data, res };
}

const newEvent = (over = {}) => ({
  title: 'Intro to Cloud',
  description: 'Hands-on workshop',
  date_time: future(10),
  venue: 'Auditorium A',
  capacity: 2,
  category: 'Workshop',
  ...over,
});

before(async () => {
  db = createDb(':memory:');
  seedAdmin(db, { adminEmail: 'admin@test.dev', adminPassword: 'adminpass123', adminName: 'Admin' });
  const app = createApp(db, { rateLimiting: false });
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://127.0.0.1:${server.address().port}/api`;

  adminToken = (await api('POST', '/auth/login', { body: { email: 'admin@test.dev', password: 'adminpass123' } })).data.token;
  userToken = (await api('POST', '/auth/register', { body: { name: 'Asha', email: 'asha@test.dev', password: 'password123' } })).data.token;
  user2Token = (await api('POST', '/auth/register', { body: { name: 'Ben', email: 'ben@test.dev', password: 'password123' } })).data.token;
});

after(() => {
  server.close();
  db.close();
});

test('auth: duplicate email, bad login and /me', async () => {
  const dup = await api('POST', '/auth/register', { body: { name: 'Asha 2', email: 'ASHA@test.dev', password: 'password123' } });
  assert.equal(dup.status, 409);

  const bad = await api('POST', '/auth/login', { body: { email: 'asha@test.dev', password: 'wrong-password' } });
  assert.equal(bad.status, 401);

  const weak = await api('POST', '/auth/register', { body: { name: 'X Y', email: 'x@test.dev', password: 'short' } });
  assert.equal(weak.status, 400);

  const me = await api('GET', '/auth/me', { token: userToken });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.role, 'user');
  assert.equal(me.data.user.password, undefined);

  assert.equal((await api('GET', '/auth/me')).status, 401);
  assert.equal((await api('GET', '/auth/me', { token: 'garbage' })).status, 401);
});

test('public sign-up cannot create an admin', async () => {
  const r = await api('POST', '/auth/register', {
    body: { name: 'Sneaky', email: 'sneaky@test.dev', password: 'password123', role: 'admin' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.role, 'user');
});

test('events: only admins can create / update / delete', async () => {
  assert.equal((await api('POST', '/events', { body: newEvent() })).status, 401);
  assert.equal((await api('POST', '/events', { token: userToken, body: newEvent() })).status, 403);

  const created = await api('POST', '/events', { token: adminToken, body: newEvent() });
  assert.equal(created.status, 201);
  const id = created.data.data.id;
  assert.equal(created.data.data.spots_left, 2);

  assert.equal((await api('PUT', `/events/${id}`, { token: userToken, body: { title: 'Hax' } })).status, 403);
  const upd = await api('PUT', `/events/${id}`, { token: adminToken, body: { title: 'Updated title' } });
  assert.equal(upd.status, 200);
  assert.equal(upd.data.data.title, 'Updated title');

  assert.equal((await api('DELETE', `/events/${id}`, { token: userToken })).status, 403);
  assert.equal((await api('DELETE', `/events/${id}`, { token: adminToken })).status, 204);
  assert.equal((await api('GET', `/events/${id}`)).status, 404);
});

test('events: validation errors', async () => {
  const noTitle = await api('POST', '/events', { token: adminToken, body: newEvent({ title: '' }) });
  assert.equal(noTitle.status, 400);
  const badCap = await api('POST', '/events', { token: adminToken, body: newEvent({ capacity: 0 }) });
  assert.equal(badCap.status, 400);
  const badDate = await api('POST', '/events', { token: adminToken, body: newEvent({ date_time: 'not-a-date' }) });
  assert.equal(badDate.status, 400);
  assert.equal((await api('GET', '/events/abc')).status, 400);
});

test('registration: success, duplicate, capacity, unregister, my list', async () => {
  const ev = (await api('POST', '/events', { token: adminToken, body: newEvent({ title: 'Cap test', capacity: 1 }) })).data.data;

  assert.equal((await api('POST', `/events/${ev.id}/register`)).status, 401);

  const ok = await api('POST', `/events/${ev.id}/register`, { token: userToken });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.data.event.spots_left, 0);
  assert.equal(ok.data.data.event.is_registered, true);

  const dup = await api('POST', `/events/${ev.id}/register`, { token: userToken });
  assert.equal(dup.status, 409);
  assert.match(dup.data.error.message, /already registered/i);

  const full = await api('POST', `/events/${ev.id}/register`, { token: user2Token });
  assert.equal(full.status, 409);
  assert.match(full.data.error.message, /full/i);

  const mine = await api('GET', '/me/registrations', { token: userToken });
  assert.equal(mine.status, 200);
  assert.ok(mine.data.data.some((r) => r.id === ev.id));

  // Admin can see the attendee list, normal users cannot.
  assert.equal((await api('GET', `/events/${ev.id}/registrations`, { token: userToken })).status, 403);
  const list = await api('GET', `/events/${ev.id}/registrations`, { token: adminToken });
  assert.equal(list.data.total, 1);

  // Unregister frees the seat for someone else.
  assert.equal((await api('DELETE', `/events/${ev.id}/register`, { token: userToken })).status, 200);
  assert.equal((await api('DELETE', `/events/${ev.id}/register`, { token: userToken })).status, 404);
  assert.equal((await api('POST', `/events/${ev.id}/register`, { token: user2Token })).status, 201);
});

test('registration: concurrent requests never exceed capacity', async () => {
  const ev = (await api('POST', '/events', { token: adminToken, body: newEvent({ title: 'Race', capacity: 3 }) })).data.data;
  const tokens = [];
  for (let i = 0; i < 8; i++) {
    const r = await api('POST', '/auth/register', {
      body: { name: `Racer ${i}`, email: `racer${i}@test.dev`, password: 'password123' },
    });
    tokens.push(r.data.token);
  }
  const results = await Promise.all(tokens.map((t) => api('POST', `/events/${ev.id}/register`, { token: t })));
  assert.equal(results.filter((r) => r.status === 201).length, 3);
  assert.equal(results.filter((r) => r.status === 409).length, 5);
  const after = await api('GET', `/events/${ev.id}`);
  assert.equal(after.data.data.registered_count, 3);
});

test('registration: cannot join past events; capacity cannot drop below registrations', async () => {
  const past = (await api('POST', '/events', { token: adminToken, body: newEvent({ title: 'Old', date_time: future(-5) }) })).data.data;
  assert.equal((await api('POST', `/events/${past.id}/register`, { token: userToken })).status, 400);

  const ev = (await api('POST', '/events', { token: adminToken, body: newEvent({ title: 'Shrink', capacity: 5 }) })).data.data;
  await api('POST', `/events/${ev.id}/register`, { token: userToken });
  await api('POST', `/events/${ev.id}/register`, { token: user2Token });
  const shrink = await api('PUT', `/events/${ev.id}`, { token: adminToken, body: { capacity: 1 } });
  assert.equal(shrink.status, 409);
  assert.equal((await api('PUT', `/events/${ev.id}`, { token: adminToken, body: { capacity: 2 } })).status, 200);
});

test('deleting an event removes its registrations', async () => {
  const ev = (await api('POST', '/events', { token: adminToken, body: newEvent({ title: 'Cascade' }) })).data.data;
  await api('POST', `/events/${ev.id}/register`, { token: userToken });
  await api('DELETE', `/events/${ev.id}`, { token: adminToken });
  const left = db.prepare('SELECT COUNT(*) AS n FROM registrations WHERE event_id = ?').get(ev.id).n;
  assert.equal(left, 0);
});

test('events: search, filter, availability and pagination', async () => {
  await api('POST', '/events', { token: adminToken, body: newEvent({ title: 'Flutter Bootcamp', category: 'Bootcamp', venue: 'Lab 3', capacity: 1 }) });
  const found = await api('GET', '/events?q=flutter');
  assert.equal(found.data.data.length, 1);

  const byCat = await api('GET', '/events?category=bootcamp');
  assert.ok(byCat.data.data.every((e) => e.category.toLowerCase() === 'bootcamp'));

  // wildcard characters in search are treated literally
  assert.equal((await api('GET', '/events?q=%25')).data.data.length, 0);

  const flutter = found.data.data[0];
  await api('POST', `/events/${flutter.id}/register`, { token: userToken });
  const avail = await api('GET', '/events?available=true&q=flutter');
  assert.equal(avail.data.data.length, 0);

  const page = await api('GET', '/events?limit=2&page=1');
  assert.equal(page.data.data.length, 2);
  assert.ok(page.data.pagination.total >= 2);

  const flagged = await api('GET', `/events/${flutter.id}`, { token: userToken });
  assert.equal(flagged.data.data.is_registered, true);

  const cats = await api('GET', '/events/categories');
  assert.ok(cats.data.data.includes('Bootcamp'));
});

test('bonus: analytics (admin only) and QR ticket (owner/admin only)', async () => {
  assert.equal((await api('GET', '/admin/analytics', { token: userToken })).status, 403);
  const stats = await api('GET', '/admin/analytics', { token: adminToken });
  assert.equal(stats.status, 200);
  assert.ok(stats.data.data.totals.registrations >= 1);

  const mine = (await api('GET', '/me/registrations', { token: userToken })).data.data;
  const regId = mine[0].registration_id;
  const qr = await api('GET', `/me/registrations/${regId}/qr`, { token: userToken });
  assert.equal(qr.status, 200);
  assert.equal(qr.res.headers.get('content-type'), 'image/png');
  assert.equal((await api('GET', `/me/registrations/${regId}/qr`, { token: user2Token })).status, 403);
});

test('misc: 404 route and malformed JSON', async () => {
  assert.equal((await api('GET', '/nope')).status, 404);
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(res.status, 400);
});
