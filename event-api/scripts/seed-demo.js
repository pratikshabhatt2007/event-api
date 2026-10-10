// Optional: fills the DB with sample events so the React UI has something to show.
// Usage: npm run seed
import { config } from '../src/config.js';
import { createDb, seedAdmin } from '../src/db.js';

const db = createDb(config.dbFile);
seedAdmin(db, config);
const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
if (!admin) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env first.');
  process.exit(1);
}

const day = 864e5;
const at = (d, h = 10) => {
  const t = new Date(Date.now() + d * day);
  t.setUTCHours(h, 0, 0, 0);
  return t.toISOString();
};
const samples = [
  ['Intro to Google Cloud', 'Hands-on session covering Compute, Storage and IAM basics.', at(7), 'Auditorium A', 80, 'Workshop'],
  ['Flutter Bootcamp', 'Build and ship a mobile app in one day.', at(12, 9), 'Lab 3', 40, 'Bootcamp'],
  ['Hack the Campus', '24-hour hackathon with mentors and prizes.', at(20, 8), 'Main Hall', 150, 'Hackathon'],
  ['AI/ML Study Jam', 'Guided Gemini and TensorFlow labs.', at(5, 14), 'Seminar Room 2', 30, 'Study Jam'],
  ['Open Source Meetup', 'Talks and a live first-PR session.', at(30, 16), 'Library Hall', 60, 'Meetup'],
];
const insert = db.prepare(
  'INSERT INTO events (title, description, date_time, venue, capacity, category, created_by) VALUES (?,?,?,?,?,?,?)',
);
let added = 0;
for (const s of samples) {
  if (!db.prepare('SELECT 1 FROM events WHERE title = ?').get(s[0])) {
    insert.run(...s, admin.id);
    added++;
  }
}
console.log(`Seeded ${added} sample event(s).`);
db.close();
