import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

// Shared AES-256-GCM helpers for encrypting a single field at rest. Same
// scheme as the TOTP secret encryption in src/lib/log-security.ts: a 12-byte
// random IV per value, and the auth tag stored alongside so tampering is
// detected on decrypt. The key comes from an env var (at least 32 chars) and
// is stretched with sha256 into exactly 32 bytes.

export type EncryptedField = {
  iv: string;
  tag: string;
  ciphertext: string;
};

function keyFromEnv(envName: string, purpose?: string) {
  const raw = process.env[envName];
  if (!raw || raw.length < 32) {
    throw new Error(`${envName} must be set to at least 32 characters`);
  }
  // A purpose gives a different key from the same secret, so data of one kind
  // is not readable with the key of another. No purpose keeps the old key.
  return createHash("sha256").update(purpose ? `${purpose}\0${raw}` : raw).digest();
}

export function encryptField(plain: string, envName: string): EncryptedField {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromEnv(envName), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptField(encrypted: EncryptedField, envName: string): string {
  const decipher = createDecipheriv("aes-256-gcm", keyFromEnv(envName), Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

// Raw bytes (receipt images). `purpose` separates the key from the string
// helpers above; `context` is authenticated but not stored, so a blob moved to
// another record (a different user or id) fails to decrypt.
export type EncryptedBytes = { iv: Buffer; tag: Buffer; data: Buffer };

export function encryptBytes(plain: Buffer, envName: string, purpose: string, context: string): EncryptedBytes {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromEnv(envName, purpose), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), data };
}

export function decryptBytes(enc: EncryptedBytes, envName: string, purpose: string, context: string): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", keyFromEnv(envName, purpose), enc.iv);
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(enc.tag);
  return Buffer.concat([decipher.update(enc.data), decipher.final()]);
}
