/**
 * Field-level AES-256-GCM encryption for sensitive DB values (API keys/secrets).
 *
 * Format: "iv:authTag:ciphertext" (all hex-encoded, colon-separated).
 * If ENCRYPTION_KEY is not set, values are stored/returned as-is (dev mode).
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { env } from "./env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;   // 96-bit IV recommended for GCM

function getKey(): Buffer | null {
  if (!env.encryptionKey || env.encryptionKey.length < 64) return null;
  return Buffer.from(env.encryptionKey, "hex");
}

/** Encrypt plaintext. Returns hex-encoded "iv:tag:ciphertext" or plaintext if key absent. */
export function encrypt(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/** Decrypt API credentials read from DB. Transparent no-op when ENCRYPTION_KEY is not set. */
export function decryptCreds<T extends { apiKey: string; apiSecret: string }>(
  cred: T
): T {
  return { ...cred, apiKey: decrypt(cred.apiKey), apiSecret: decrypt(cred.apiSecret) };
}

/** Decrypt a value produced by encrypt(). Returns plaintext, or the input unchanged if not encrypted. */
export function decrypt(value: string): string {
  const key = getKey();
  if (!key) return value;

  const parts = value.split(":");
  if (parts.length !== 3) return value; // not encrypted — return as-is

  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const data = Buffer.from(dataHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
