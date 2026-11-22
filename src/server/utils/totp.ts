import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function encodeBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

export function decodeBase32(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export function generateTotpSecret(byteLength = 20): string {
  return encodeBase32(crypto.randomBytes(byteLength));
}

export function generateTotpCode(
  base32Secret: string,
  timeStepCounter = Math.floor(Date.now() / 30000)
): string {
  const key = decodeBase32(base32Secret);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(timeStepCounter));

  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotpCode(
  base32Secret: string,
  candidateCode: string,
  windowSteps = 1,
  nowMs = Date.now()
): boolean {
  const normalized = candidateCode.replace(/\s+/g, '').trim();
  if (!/^\d{6}$/.test(normalized)) return false;

  const currentStep = Math.floor(nowMs / 30000);
  const candidateBuf = Buffer.from(normalized, 'utf8');

  for (let offset = -windowSteps; offset <= windowSteps; offset++) {
    const expected = generateTotpCode(base32Secret, currentStep + offset);
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (
      candidateBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(candidateBuf, expectedBuf)
    ) {
      return true;
    }
  }

  return false;
}

export function buildOtpAuthUri(
  username: string,
  base32Secret: string,
  issuer = 'THE GRID Admin'
): string {
  const label = encodeURIComponent(`${issuer}:${username}`);
  const issuerParam = encodeURIComponent(issuer);
  return `otpauth://totp/${label}?secret=${base32Secret}&issuer=${issuerParam}&algorithm=SHA1&digits=6&period=30`;
}
