import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, type ScryptOptions } from "crypto";
import { AsyncLocalStorage } from "async_hooks";
import { gunzip, gzip } from "zlib";
import { z } from "zod";

// Passphrase-encrypted backup file. The passphrase is stretched with scrypt
// into an AES-256-GCM key; the header is bound to the ciphertext as additional
// authenticated data, so a changed salt, IV, cost or date fails the same way a
// wrong passphrase does. Nothing here logs or stores the passphrase.

export const BACKUP_FORMAT = "expense-tracker-backup";
// New files are version 2. Version 1 files (made before the cost went up) still
// open: their lower cost stays whitelisted, so a backup kept for a while restores.
export const BACKUP_VERSION = 2;

// The only costs the format allows, per version. A file cannot ask for more (or
// less): the header is checked against these numbers before any key work starts.
const SCRYPT_COST = { 1: 65536, 2: 131072 } as const;
type FileVersion = keyof typeof SCRYPT_COST;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
// scrypt needs 128 * N * r bytes (128 MiB at version 2); allow double for overhead.
const maxmemFor = (n: number) => 128 * n * SCRYPT_R * 2;

export const PASSPHRASE_MIN = 12;
export const PASSPHRASE_MAX = 256;

// Largest encrypted file a restore reads. It is what POST /backup can produce: that
// route refuses an answer over MAX_RESPONSE_BYTES (4 MB, under Vercel's 4.5 MB
// response limit), and the base64 of 3,000,000 bytes plus its envelope is about
// 4 MB. A request body the same size is also under Vercel's 4.5 MB request limit.
// Self-hosted servers use the same numbers; a bigger account exports as CSV.
export const MAX_BACKUP_BYTES = 3_000_000;
// Largest plain text a file may unpack to (guards a compression bomb inside a
// file that does open).
export const MAX_PLAIN_BYTES = 48 * 1024 * 1024;

export type BackupFailure = "unreadable" | "invalid" | "too_large" | "too_large_for_response" | "busy" | "timeout" | "base_currency_mismatch";

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

const cipherText = z
  .string()
  .min(1)
  .max(Math.ceil((MAX_BACKUP_BYTES * 4) / 3) + 4)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);

const envelopeFor = <V extends FileVersion>(v: V) =>
  z
    .object({
      format: z.literal(BACKUP_FORMAT),
      v: z.literal(v),
      createdAt: z.string().max(40),
      kdf: z
        .object({
          name: z.literal("scrypt"),
          N: z.literal(SCRYPT_COST[v]),
          r: z.literal(SCRYPT_R),
          p: z.literal(SCRYPT_P),
          salt: b64(16),
        })
        .strict(),
      cipher: z.object({ name: z.literal("aes-256-gcm"), iv: b64(12), tag: b64(16) }).strict(),
      ciphertext: cipherText,
    })
    .strict();

export const backupEnvelopeSchema = z.discriminatedUnion("v", [envelopeFor(1), envelopeFor(2)]);

export type BackupEnvelope = z.infer<typeof backupEnvelopeSchema>;

export const passphraseSchema = z.string().min(PASSPHRASE_MIN).max(PASSPHRASE_MAX);

function aad(e: { v: number; createdAt: string; kdf: { N: number; r: number; p: number; salt: string }; cipher: { iv: string } }) {
  return Buffer.from(
    [BACKUP_FORMAT, e.v, e.createdAt, "scrypt", e.kdf.N, e.kdf.r, e.kdf.p, e.kdf.salt, "aes-256-gcm", e.cipher.iv].join("|"),
    "utf8"
  );
}

// The gate covers whole jobs (database reads, compression and key derivation),
// two at a time per server process: scrypt alone holds 128 MiB, and a job holds
// the rest of its memory too. A short queue waits behind them (four), and each
// waiter gives up after a while; anything past the queue is turned away at once.
// A job that runs too long (a stalled database call) is cut loose after jobMs,
// below the platform's maximum duration, so one stuck job cannot pin a slot for
// everyone. JavaScript cannot stop the work itself: it is abandoned, not killed.
const MAX_ACTIVE = 2;
const MAX_QUEUE = 4;
export const GATE_LIMITS = { waitMs: 10_000, jobMs: 50_000 };
type Waiter = { go: () => void; timer: ReturnType<typeof setTimeout> };
let active = 0;
const waiting: Waiter[] = [];
/** True if a job could start or queue now. Routes ask before reading a body, so a flood cannot pile up bodies behind a full gate. */
export function keyGateOpen() {
  return active < MAX_ACTIVE || waiting.length < MAX_QUEUE;
}

// Work running inside withKeyGate already holds a slot, so a derivation inside it
// does not ask for a second one (two nested jobs could otherwise deadlock the gate).
const holdsSlot = new AsyncLocalStorage<true>();

/**
 * Hold a slot for the whole of a job. A route takes it BEFORE the database and
 * compression work, so "busy" always comes back before any expensive work has
 * started (and only then may a caller get a rate limit count back). It throws
 * "busy" only while waiting to start, never once `work` is running; a job that
 * overruns throws "timeout" and its slot is freed.
 */
export function withKeyGate<T>(work: () => Promise<T>): Promise<T> {
  return withKeySlot(() => holdsSlot.run(true, work));
}

const busy = () => new BackupError("busy", "The server is busy opening backups; try again in a moment");

async function withKeySlot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= MAX_ACTIVE) {
    if (waiting.length >= MAX_QUEUE) throw busy();
    // The finishing job hands its slot straight to us, so `active` stays put.
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        go: () => {
          clearTimeout(waiter.timer);
          resolve();
        },
        timer: setTimeout(() => {
          const at = waiting.indexOf(waiter);
          if (at >= 0) waiting.splice(at, 1);
          reject(busy());
        }, GATE_LIMITS.waitMs),
      };
      waiting.push(waiter);
    });
  } else {
    active += 1;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new BackupError("timeout", "The backup took too long; try again")), GATE_LIMITS.jobMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    const next = waiting.shift();
    if (next) next.go();
    else active -= 1;
  }
}

function deriveKey(passphrase: string, salt: Buffer, n: number): Promise<Buffer> {
  const options: ScryptOptions = { N: n, r: SCRYPT_R, p: SCRYPT_P, maxmem: maxmemFor(n) };
  const run = () =>
    new Promise<Buffer>((resolve, reject) => {
      scrypt(passphrase.normalize("NFKC"), salt, 32, options, (err, key) => (err ? reject(err) : resolve(key)));
    });
  return holdsSlot.getStore() ? run() : withKeySlot(run);
}

const gzipAsync = (data: Buffer) =>
  new Promise<Buffer>((resolve, reject) => gzip(data, (err, out) => (err ? reject(err) : resolve(out))));
const gunzipAsync = (data: Buffer) =>
  new Promise<Buffer>((resolve, reject) =>
    gunzip(data, { maxOutputLength: MAX_PLAIN_BYTES }, (err, out) => (err ? reject(err) : resolve(out)))
  );

/** Encrypt already gzipped bytes. Exported for tests that need an unusual body. */
export async function sealPacked(
  packed: Buffer,
  passphrase: string,
  opts: { createdAt?: string; version?: FileVersion } = {}
): Promise<BackupEnvelope> {
  const version = opts.version ?? BACKUP_VERSION;
  const createdAt = opts.createdAt ?? new Date().toISOString();
  const n = SCRYPT_COST[version];
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(passphrase, salt, n);
  const header = {
    v: version,
    createdAt,
    kdf: { name: "scrypt" as const, N: n, r: SCRYPT_R as 8, p: SCRYPT_P as 1, salt: salt.toString("base64") },
    cipher: { iv: iv.toString("base64") },
  };
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(header));
  const ciphertext = Buffer.concat([cipher.update(packed), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (ciphertext.length > MAX_BACKUP_BYTES) throw new BackupError("too_large", "Backup is too large");

  return {
    format: BACKUP_FORMAT,
    v: version,
    createdAt,
    kdf: header.kdf,
    cipher: { name: "aes-256-gcm", iv: header.cipher.iv, tag: tag.toString("base64") },
    ciphertext: ciphertext.toString("base64"),
  } as BackupEnvelope;
}

/** JSON then gzip. Its length is (to within the 16 byte tag) the length of the ciphertext. */
export async function packBackup(payload: unknown): Promise<Buffer> {
  const plain = Buffer.from(JSON.stringify(payload), "utf8");
  if (plain.length > MAX_PLAIN_BYTES) throw new BackupError("too_large", "Backup is too large");
  return gzipAsync(plain);
}

export async function encryptBackup(
  payload: unknown,
  passphrase: string,
  opts: { createdAt?: string; version?: FileVersion } = {}
): Promise<BackupEnvelope> {
  return sealPacked(await packBackup(payload), passphrase, opts);
}

// Vercel Functions allow at most 4.5 MB in a response body, so POST /backup stops
// short of that. The envelope around the base64 ciphertext and the counts fit in
// the 8 KiB reserved here.
export const MAX_RESPONSE_BYTES = 4_000_000;
export const RESPONSE_OVERHEAD_BYTES = 8 * 1024;
export const estimatedResponseBytes = (packedLength: number) => Math.ceil((packedLength + 16) / 3) * 4 + RESPONSE_OVERHEAD_BYTES;

// A wrong passphrase and a changed file give the same answer on purpose.
const UNREADABLE = "Could not open the backup. Check the passphrase and that the file is unchanged.";

export async function decryptBackup(input: unknown, passphrase: string): Promise<unknown> {
  const parsed = backupEnvelopeSchema.safeParse(input);
  if (!parsed.success) throw new BackupError("invalid", "This is not a backup file this server can read");
  const env = parsed.data;

  let packed: Buffer;
  try {
    const key = await deriveKey(passphrase, Buffer.from(env.kdf.salt, "base64"), env.kdf.N);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(env.cipher.iv, "base64"));
    decipher.setAAD(aad(env));
    decipher.setAuthTag(Buffer.from(env.cipher.tag, "base64"));
    packed = Buffer.concat([decipher.update(Buffer.from(env.ciphertext, "base64")), decipher.final()]);
  } catch (err) {
    if (err instanceof BackupError) throw err; // "busy" is not a wrong passphrase
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
