import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getDb } from '../db/database.ts';
import { type EvlogVariables } from 'evlog/hono';
import { createError } from 'evlog';
import { mutationBodyLimit, readJsonBody } from './mutation-helpers.ts';
import type { WhatsAppConnection } from '../whatsapp/connection.ts';

export const createSettingsRouter = (
  client?: Pick<WhatsAppConnection, 'updatePrivacySetting'>,
) => {
  const settings = new Hono<EvlogVariables>();

  settings.get('/', async (c) => {
    const db = getDb();
    return c.json(db.getSettings());
  });

  settings.post('/update', bodyLimit(mutationBodyLimit), async (c) => {
    const db = getDb();

    const body = (await readJsonBody(c)) as { key?: unknown; value?: unknown };
    const { key, value } = body;

    if (typeof key !== 'string' || typeof value !== 'string') {
      throw createError({
        message: 'Invalid request body',
        status: 400,
        why: 'Key and value must be strings',
        fix: 'Provide key and value as strings',
      });
    }

    if (key.length > 1024 || value.length > 1024) {
      throw createError({
        message: 'Payload too large',
        status: 400,
        why: 'Key or value exceeds maximum length',
        fix: 'Use shorter key or value',
      });
    }

    if (key === 'whatsapp_hide_online' || key === 'whatsapp_hide_read_receipts') {
      if (value !== 'true' && value !== 'false') {
        throw createError({
          message: 'Invalid privacy setting value',
          status: 400,
          why: 'Privacy settings must be either true or false',
          fix: 'Provide "true" or "false"',
        });
      }
      if (!client) {
        throw createError({
          message: 'WhatsApp connection unavailable',
          status: 503,
          why: 'Privacy settings cannot be applied without the WhatsApp connection',
          fix: 'Retry the update through the running server',
        });
      }
      await client.updatePrivacySetting(key, value);
    }

    db.updateSetting(key, value);
    return c.json({ success: true });
  });

  return settings;
};

export default createSettingsRouter();
