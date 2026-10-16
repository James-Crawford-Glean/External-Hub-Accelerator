import { randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; // base62
const ID_LEN = 14; // ~83 bits; collision-safe for the user registry

/**
 * Internal user id: `usr_` + 14 base62 chars (e.g. `usr_7Kf3Qb9RtX2mLp`). Minted
 * in TypeScript so one algorithm serves every mint site instead of
 * `gen_random_uuid()` in SQL (hex, longer, awkward to make base62 in the DB).
 *
 * Unbiased: reject bytes >= 248 (= 62*4) before the modulo so every symbol is equally
 * likely (256 % 62 != 0 would skew the first 8 symbols otherwise).
 */
export function genUserId(): string {
  let out = '';
  while (out.length < ID_LEN) {
    for (const b of randomBytes(ID_LEN * 2)) {
      if (b >= 248) continue;
      out += ALPHABET[b % 62];
      if (out.length === ID_LEN) break;
    }
  }
  return `usr_${out}`;
}
