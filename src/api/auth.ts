import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { mutationBodyLimit, readJsonBody } from './mutation-helpers.ts';
import { getDb } from '../db/database.ts';
import { getClientIp, checkApiRateLimit, apiRateLimits, verifySession } from './utils.ts';
import { log } from '../logger.ts';
import * as crypto_node from 'crypto';
import { type EvlogVariables } from 'evlog/hono';
import { createError } from 'evlog';
import { createTotpUri, generateTotpSecret, verifyTotpCode } from './totp.ts';

const auth = new Hono<EvlogVariables>();

const startTime = Date.now();
const SESSION_DURATION_HOURS = 24 * 7; // 7 days

// Login attempt tracking
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_LOGIN_ATTEMPTS = 5;

function enforceLoginRateLimit(c: Context<EvlogVariables>, ip: string) {
  if (checkApiRateLimit(ip, 'login', MAX_LOGIN_ATTEMPTS, LOGIN_WINDOW_MS)) return;
  const logger = c.get('log');
  logger.set({ outcome: { error: 'rate_limited' } });
  logger.warn(`Login rate-limited for IP ${ip}`);
  throw createError({
    message: 'Too many login attempts',
    status: 429,
    why: 'Maximum login attempts exceeded for this IP',
    fix: 'Try again in 15 minutes'
  });
}

function requireFingerprint(fingerprint: string, c: Context<EvlogVariables>, ip: string) {
  if (fingerprint) return;
  const logger = c.get('log');
  logger.set({ outcome: { error: 'missing_fingerprint' } });
  logger.warn(`Login failed from ${ip}: missing fingerprint`);
  throw createError({
    message: 'Client fingerprint is mandatory',
    status: 400,
    why: 'Browser fingerprinting is required for secure session binding',
    fix: 'Ensure ThumbmarkJS is active and sending a fingerprint'
  });
}

function verifyPassword(password: unknown, c: Context<EvlogVariables>, ip: string): void {
  const serverPassword = process.env.AUTH_PASSWORD || '';
  const maxPasswordLength = Math.max(1024, serverPassword.length * 2);

  if (typeof password !== 'string' || password.length > maxPasswordLength) {
    const logger = c.get('log');
    logger.set({ outcome: { error: 'invalid_password_format' } });
    logger.warn(`Login failed from ${ip}: invalid password format or length`);
    throw createError({
      message: 'Invalid password format',
      status: 400,
      why: 'The password provided is not a string or is too long',
      fix: 'Provide a valid string password'
    });
  }

  const passwordBuffer = Buffer.from(password);
  const serverPasswordBuffer = Buffer.from(serverPassword);
  let isMatch = false;
  if (passwordBuffer.length === serverPasswordBuffer.length) {
    isMatch = crypto_node.timingSafeEqual(passwordBuffer, serverPasswordBuffer);
  } else {
    crypto_node.timingSafeEqual(serverPasswordBuffer, serverPasswordBuffer);
  }

  if (isMatch) return;
  const logger = c.get('log');
  logger.set({ outcome: { error: 'wrong_password' } });
  logger.warn(`Login failed from ${ip}`);
  throw createError({
    message: 'Invalid password',
    status: 401,
    why: 'The provided password does not match AUTH_PASSWORD',
    fix: 'Double check your AUTH_PASSWORD environment variable'
  });
}

function createAuthenticatedSession(
  c: Context<EvlogVariables>,
  db: ReturnType<typeof getDb>,
  fingerprint: string,
  ip: string,
) {
  const token = crypto.randomUUID().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 3600_000).toISOString();
  db.createSession(token, fingerprint, expiresAt);

  const isProduction = process.env.NODE_ENV === 'production';
  const isHttps = c.req.url.startsWith('https://') || c.req.header('x-forwarded-proto') === 'https';
  setCookie(c, 'auth_token', token, {
    path: '/',
    httpOnly: true,
    secure: isHttps && isProduction,
    sameSite: 'Lax',
    maxAge: SESSION_DURATION_HOURS * 3600
  });
  setCookie(c, 'auth_fp', fingerprint, {
    path: '/',
    httpOnly: true,
    secure: isHttps && isProduction,
    sameSite: 'Lax',
    maxAge: SESSION_DURATION_HOURS * 3600
  });

  apiRateLimits.delete(`${ip}:login`);
  c.get('log').set({
    outcome: { success: true },
    client: { fingerprint_provided: true }
  });
  log('AUTH', `Login success from ${ip}, fingerprint: yes`);
  return c.json({ success: true, token });
}

function checkTotpOrThrow(secret: string, code: unknown, c: Context<EvlogVariables>, ip: string): number {
  const step = typeof code === 'string' ? verifyTotpCode(secret, code) : null;
  if (step !== null) return step;
  const logger = c.get('log');
  logger.set({ outcome: { error: 'invalid_totp_code' } });
  logger.warn(`Login failed from ${ip}: invalid authenticator code`);
  throw createError({
    message: 'Invalid password or authenticator code',
    status: 401,
    why: 'The authenticator code is invalid or expired',
    fix: 'Enter the current six-digit code from your authenticator app'
  });
}

auth.get('/uptime', (c) => {
  return c.json({ uptime: Math.floor((Date.now() - startTime) / 1000) });
});

auth.post('/login', bodyLimit(mutationBodyLimit), async (c) => {
  const db = getDb();
  const ip = getClientIp(c);
  enforceLoginRateLimit(c, ip);

  const body = (await readJsonBody(c)) as {
    password?: unknown;
    fingerprint?: unknown;
    code?: unknown;
  };
  const fingerprint = typeof body.fingerprint === 'string' ? body.fingerprint : '';
  requireFingerprint(fingerprint, c, ip);
  verifyPassword(body.password, c, ip);

  const config = db.getTotpConfig();
  if (!config.enabled) {
    const secret = db.getOrCreateTotpSecret(config.secret || generateTotpSecret());
    c.get('log').set({ outcome: { success: false, next_step: 'totp_setup' } });
    return c.json({
      success: false,
      requiresTotpSetup: true,
      secret,
      otpAuthUrl: createTotpUri(secret)
    });
  }

  if (typeof body.code !== 'string') {
    return c.json({ success: false, requiresTotp: true });
  }

  if (!config.secret) {
    throw createError({
      message: 'Authenticator configuration is invalid',
      status: 500,
      why: 'Enabled authenticator has no secret',
      fix: 'Restore the authenticator configuration from a database backup'
    });
  }
  const step = checkTotpOrThrow(config.secret, body.code, c, ip);
  if (!db.consumeTotpStep(step)) {
    throw createError({
      message: 'Authenticator code already used',
      status: 401,
      why: 'Authenticator codes can only be used once',
      fix: 'Wait for the next code and try again'
    });
  }
  return createAuthenticatedSession(c, db, fingerprint, ip);
});

auth.post('/totp/enable', bodyLimit(mutationBodyLimit), async (c) => {
  const db = getDb();
  const ip = getClientIp(c);
  enforceLoginRateLimit(c, ip);

  const body = (await readJsonBody(c)) as {
    password?: unknown;
    fingerprint?: unknown;
    code?: unknown;
  };
  const fingerprint = typeof body.fingerprint === 'string' ? body.fingerprint : '';
  requireFingerprint(fingerprint, c, ip);
  verifyPassword(body.password, c, ip);

  const config = db.getTotpConfig();
  if (!config.secret || config.enabled) {
    throw createError({
      message: 'Authenticator setup is not available',
      status: 409,
      why: 'No pending authenticator setup exists',
      fix: 'Start setup from the sign-in page'
    });
  }

  const step = checkTotpOrThrow(config.secret, body.code, c, ip);
  if (!db.enableTotp(step)) {
    throw createError({
      message: 'Authenticator setup could not be completed',
      status: 409,
      why: 'The setup state changed or this code was already used',
      fix: 'Restart sign-in and use a current authenticator code'
    });
  }

  return createAuthenticatedSession(c, db, fingerprint, ip);
});

auth.get('/verify', async (c) => {
  const db = getDb();
  const token = getCookie(c, 'auth_token') || c.req.header('X-Auth-Token');
  const fingerprint = c.req.header('X-Fingerprint') || getCookie(c, 'auth_fp');

  const { authenticated, session } = verifySession(db, token, fingerprint);

  return c.json({ 
    authenticated,
    fingerprint: session?.fingerprint 
  });
});

auth.post('/logout', bodyLimit(mutationBodyLimit), async (c) => {
  const db = getDb();
  const token = getCookie(c, 'auth_token') || c.req.header('X-Auth-Token');
  if (token) db.deleteSession(token);
  deleteCookie(c, 'auth_token');
  return c.json({ success: true });
});

export default auth;
