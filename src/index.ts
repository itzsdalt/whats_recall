import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import './load-env.ts';
import { getDb } from './db/database.ts';
import { WhatsAppConnection } from './whatsapp/connection.ts';
import { createHonoServer } from './api/server.ts';
import { log } from './logger.ts';
import type { BroadcastEvent } from './types.ts';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.PUBLIC_DIR) {
  const publicDir = resolve(projectDir, 'public');
  process.env.PUBLIC_DIR = publicDir;

  log('BOOT', 'Building dashboard frontend');
  execFileSync('npm', ['run', 'build'], {
    cwd: projectDir,
    stdio: 'inherit',
  });

  if (!existsSync(join(publicDir, 'index.html'))) {
    throw new Error(`Frontend build completed without creating ${join(publicDir, 'index.html')}`);
  }
}

log('BOOT', 'Starting WhatsRecall (Modular TypeScript Edition)');
log('BOOT', `Node env: ${process.env.NODE_ENV || 'development'}`);

// 1. Initialize Database
const db = getDb();
log('BOOT', 'Database initialized');

// 2. Setup Client & Server with Broadcast Loop
let broadcastRef = (_event: BroadcastEvent, _data: any) => { };

const client = new WhatsAppConnection((event, data) => broadcastRef(event, data));
const { start } = createHonoServer(client);
const { broadcast } = start();

// Hook the broadcast function from the server back into the client
broadcastRef = broadcast;

// 3. Start WhatsApp Monitoring
client.start();

// Shutdown Handlers
process.on('SIGINT', () => {
  log('BOOT', 'Shutting down (SIGINT)...');
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('BOOT', 'Shutting down (SIGTERM)...');
  db.close();
  process.exit(0);
});
