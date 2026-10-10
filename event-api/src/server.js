import { config } from './config.js';
import { createDb, seedAdmin } from './db.js';
import { createApp } from './app.js';

const db = createDb(config.dbFile);
const adminId = seedAdmin(db, config);
if (adminId) console.log(`Admin account ready (${config.adminEmail})`);
else console.log('No ADMIN_EMAIL/ADMIN_PASSWORD set - no admin account was created.');

const app = createApp(db);
const server = app.listen(config.port, () => {
  console.log(`Event API listening on http://localhost:${config.port}`);
});

const shutdown = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
