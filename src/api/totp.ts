import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const CODE_DIGITS = 6;
const STEP_SECONDS = 30;

export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  let value = 0;
  let bits = 0;
  let secret = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      secret += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) secret += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return secret;
}

function decodeBase32(secret: string): Buffer {
  let value = 0;
  let bits = 0;
  const bytes: number[] = [];

  for (const character of secret.replace(/=+$/, '').toUpperCase()) {
    const digit = BASE32_ALPHABET.indexOf(character);
    if (digit < 0) throw new Error('Invalid TOTP secret');
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export function generateTotpCode(secret: string, timestamp = Date.now()): string {
  const counter = BigInt(Math.floor(timestamp / 1000 / STEP_SECONDS));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary =
    ((digest[offset] & 127) << 24) |
    ((digest[offset + 1] & 255) << 16) |
    ((digest[offset + 2] & 255) << 8) |
    (digest[offset + 3] & 255);

  return (binary % 10 ** CODE_DIGITS).toString().padStart(CODE_DIGITS, '0');
}

export function verifyTotpCode(
  secret: string,
  code: string,
  timestamp = Date.now(),
): number | null {
  if (!/^\d{6}$/.test(code)) return null;

  const currentStep = Math.floor(timestamp / 1000 / STEP_SECONDS);
  for (const step of [currentStep, currentStep - 1, currentStep + 1]) {
    const expected = generateTotpCode(secret, step * STEP_SECONDS * 1000);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return step;
  }

  return null;
}

export function createTotpUri(secret: string): string {
  const label = encodeURIComponent('WhatsRecall:admin');
  const issuer = encodeURIComponent('WhatsRecall');
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${CODE_DIGITS}&period=${STEP_SECONDS}`;
}
