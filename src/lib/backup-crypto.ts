import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, type ScryptOptions } from "crypto";
import { gunzip, gzip } from "zlib";
import { z } from "zod";

// Passphrase-encrypted backup file. The passphrase is stretched with scrypt
// into an AES-256-GCM key; the header is bound to the ciphertext as additional
// authenticated data, so a changed salt, IV, cost or date fails the same way a
// wrong passphrase does. Nothing here logs or stores the passphrase.

export const BACKUP_FORMAT = "expense-tracker-backup";
export const BACKUP_VERSION = 1;

// The only cost the format allows. A file cannot ask for more (or less): the
// header is checked against these numbers before any key work starts.
const SCRYPT_N = 65536;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_R * 2;

export const PASSPHRASE_MIN = 12;
export const PASSPHRASE_MAX = 256;

// Largest encrypted body a restore reads, and largest plain text a file may
// unpack to (guards a compression bomb inside a file that does open).
export const MAX_BACKUP_BYTES = 24 * 1024 * 1024;
export const MAX_PLAIN_BYTES = 48 * 1024 * 1024;

export type BackupFailure = "unreadable" | "invalid" | "too_large";

export class BackupError extends Error {
  constructor(
    public readonly reason: BackupFailure,
    message: string
  ) {
    super(message);
    this.name = "BackupError";
  }
}

const b64 = (bytes: number) => {
  const chars = Math.ceil(bytes / 3) * 4;
  return z.string().length(chars).regex(/^[A-Za-z0-9+/]+={0,2}$/);
};

export const backupEnvelopeSchema = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    v: z.literal(BACKUP_VERSION),
    createdAt: z.string().max(40),
    kdf: z
      .object({
        name: z.literal("scrypt"),
        N: z.literal(SCRYPT_N),
        r: z.literal(SCRYPT_R),
        p: z.literal(SCRYPT_P),
        salt: b64(16),
      })
      .strict(),
    cipher: z.object({ name: z.literal("aes-256-gcm"), iv: b64(12), tag: b64(16) }).strict(),
    ciphertext: z
      .string()
      .min(1)
      .max(Math.ceil((MAX_BACKUP_BYTES * 4) / 3) + 4)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();

export type BackupEnvelope = z.infer<typeof backupEnvelopeSchema>;

export const passphraseSchema = z.string().min(PASSPHRASE_MIN).max(PASSPHRASE_MAX);

function aad(e: Pick<BackupEnvelope, "createdAt" | "kdf"> & { cipher: { iv: string } }) {
  return Buffer.from(
    [BACKUP_FORMAT, BACKUP_VERSION, e.createdAt, "scrypt", e.kdf.N, e.kdf.r, e.kdf.p, e.kdf.salt, "aes-256-gcm", e.cipher.iv].join("|"),
    "utf8"
  );
}

// scrypt holds 64 MiB while it runs; at most two run at once, the rest queue.
let active = 0;
const waiting: Array<() => void> = [];
async function withKeySlot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
  try {
    return await work();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  const options: ScryptOptions = { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM };
  return withKeySlot(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        scrypt(passphrase.normalize("NFKC"), salt, 32, options, (err, key) => (err ? reject(err) : resolve(key)));
      })
  );
}

const gzipAsync = (data: Buffer) =>
  new Promise<Buffer>((resolve, reject) => gzip(data, (err, out) => (err ? reject(err) : resolve(out))));
const gunzipAsync = (data: Buffer) =>
  new Promise<Buffer>((resolve, reject) =>
    gunzip(data, { maxOutputLength: MAX_PLAIN_BYTES }, (err, out) => (err ? reject(err) : resolve(out)))
  );

export async function encryptBackup(payload: unknown, passphrase: string, createdAt = new Date().toISOString()): Promise<BackupEnvelope> {
  const plain = Buffer.from(JSON.stringify(payload), "utf8");
  if (plain.length > MAX_PLAIN_BYTES) throw new BackupError("too_large", "Backup is too large");
  const packed = await gzipAsync(plain);

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(passphrase, salt);
  const header = {
    createdAt,
    kdf: { name: "scrypt" as const, N: SCRYPT_N as 65536, r: SCRYPT_R as 8, p: SCRYPT_P as 1, salt: salt.toString("base64") },
    cipher: { iv: iv.toString("base64") },
  };
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(header));
  const ciphertext = Buffer.concat([cipher.update(packed), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (ciphertext.length > MAX_BACKUP_BYTES) throw new BackupError("too_large", "Backup is too large");

  return {
    format: BACKUP_FORMAT,
    v: BACKUP_VERSION,
    createdAt,
    kdf: header.kdf,
    cipher: { name: "aes-256-gcm", iv: header.cipher.iv, tag: tag.toString("base64") },
    ciphertext: ciphertext.toString("base64"),
  };
}

// A wrong passphrase and a changed file give the same answer on purpose.
const UNREADABLE = "Could not open the backup. Check the passphrase and that the file is unchanged.";

export async function decryptBackup(input: unknown, passphrase: string): Promise<unknown> {
  const parsed = backupEnvelopeSchema.safeParse(input);
  if (!parsed.success) throw new BackupError("invalid", "This is not a backup file this server can read");
  const env = parsed.data;

  let packed: Buffer;
  try {
    const key = await deriveKey(passphrase, Buffer.from(env.kdf.salt, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(env.cipher.iv, "base64"));
    decipher.setAAD(aad(env));
    decipher.setAuthTag(Buffer.from(env.cipher.tag, "base64"));
    packed = Buffer.concat([decipher.update(Buffer.from(env.ciphertext, "base64")), decipher.final()]);
  } catch {
    throw new BackupError("unreadable", UNREADABLE);
  }

  let plain: Buffer;
  try {
    plain = await gunzipAsync(packed);
  } catch {
    throw new BackupError("unreadable", UNREADABLE);
  }
  try {
    return JSON.parse(plain.toString("utf8"));
  } catch {
    throw new BackupError("unreadable", UNREADABLE);
  }
}

/** A short fingerprint of an encrypted file, for idempotency (never of the passphrase or plain text). */
export function envelopeDigest(env: BackupEnvelope): string {
  return createHash("sha256").update(env.cipher.iv).update(env.cipher.tag).update(env.ciphertext).digest("hex");
}
