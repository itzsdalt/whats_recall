import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

if (existsSync('.env')) {
  loadEnvFile('.env');
}

if (process.env.TIME_ZONE) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: process.env.TIME_ZONE }).format();
  } catch {
    throw new Error(`Invalid TIME_ZONE: ${process.env.TIME_ZONE}`);
  }
  process.env.TZ = process.env.TIME_ZONE;
}
