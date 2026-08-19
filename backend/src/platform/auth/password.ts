import argon2 from 'argon2';

/**
 * Password hashing (Phase 1 decision #1, see DECISIONS.md): argon2id
 * over bcrypt for better resistance to GPU-accelerated cracking, given
 * this system holds guest PII and payment references downstream.
 */
export function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    // argon2.verify throws on a malformed hash rather than returning false.
    return false;
  }
}
