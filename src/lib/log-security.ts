import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import { config } from "@/lib/config";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import LogSecurity from "@/models/LogSecurity";
import LogUnlockSession from "@/models/LogUnlockSession";
import { verifyPassword } from "@/utils/password";

type EncryptedSecret = {
  iv: string;
  tag: string;
  ciphertext: string;
};

export const LOG_UNLOCK_MINUTES = 5;

function encryptionKey() {
  const rawKey = process.env.TOTP_ENCRYPTION_KEY;
  if (!rawKey || rawKey.length < 32) {
    throw new Error("TOTP_ENCRYPTION_KEY must be set to at least 32 characters");
  }
  return createHash("sha256").update(rawKey).digest();
}

function encryptSecret(secret: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptSecret(encrypted: EncryptedSecret) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(encrypted.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function normalizeOtp(code: string) {
  return code.replace(/\s+/g, "");
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hashDeviceUnlockId(userId: string, sessionJti: string, deviceUnlockId: string) {
  return hashValue(`${userId}:${sessionJti}:${deviceUnlockId}:${process.env.NEXTAUTH_SECRET ?? ""}`);
}

function hashUserAgent(userAgent: string) {
  return hashValue(userAgent || "unknown");
}

function validateDeviceUnlockId(deviceUnlockId: string) {
  return deviceUnlockId.length >= 32 && deviceUnlockId.length <= 256;
}

function generateRecoveryCodes() {
  return Array.from({ length: 10 }, () => randomBytes(5).toString("hex").toUpperCase());
}

function verifyAuthenticatorCode(secret: string, code: string) {
  return verifySync({ secret, token: normalizeOtp(code), epochTolerance: 30 }).valid;
}

async function hashRecoveryCodes(codes: string[]) {
  return Promise.all(codes.map(async (code) => ({ hash: await bcrypt.hash(code, 12) })));
}

async function requireCurrentPassword(userId: string, currentPassword: string) {
  const user = await User.findById(userId).select("password").lean<{ password: string }>();
  return Boolean(user && await verifyPassword(currentPassword, user.password));
}

function createTotpSetupPayload(email: string, secret: string) {
  const label = `${config.app.name}:${email}`;
  const otpauth = generateURI({ issuer: config.app.name, label: email, secret });
  return { label, otpauth };
}

export async function getLogSecurityStatus(userId: string) {
  await connectDB();
  const security = await LogSecurity.findOne({ user: userId }).lean<{
    isEnabled?: boolean;
    pendingSecretExpiresAt?: Date;
    recoveryCodes?: Array<{ usedAt?: Date }>;
  }>();

  return {
    isEnabled: security?.isEnabled === true,
    hasPendingSetup: Boolean(
      security?.pendingSecretExpiresAt && new Date(security.pendingSecretExpiresAt) > new Date()
    ),
    recoveryCodesRemaining: security?.recoveryCodes?.filter((code) => !code.usedAt).length ?? 0,
  };
}

export async function beginTotpSetup(userId: string, email: string) {
  await connectDB();
  const existing = await LogSecurity.findOne({ user: userId }).lean<{ isEnabled?: boolean }>();
  if (existing?.isEnabled === true) {
    return { ok: false, reason: "Authenticator is already enabled. Use rotation to replace it." };
  }

  const secret = generateSecret();
  const { label, otpauth } = createTotpSetupPayload(email, secret);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauth);

  await LogSecurity.findOneAndUpdate(
    { user: userId },
    {
      $set: {
        pendingEncryptedSecret: encryptSecret(secret),
        pendingSecretExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
      $setOnInsert: { recoveryCodes: [] },
    },
    { upsert: true, new: true }
  );

  return { ok: true, label, secret, qrCodeDataUrl };
}

export async function verifyTotpSetup(userId: string, code: string) {
  await connectDB();
  const security = await LogSecurity.findOne({ user: userId });
  if (!security?.pendingEncryptedSecret || !security.pendingSecretExpiresAt) {
    return { ok: false, reason: "No pending setup was found" };
  }

  if (new Date(security.pendingSecretExpiresAt) <= new Date()) {
    return { ok: false, reason: "Setup expired. Start again to get a fresh QR code." };
  }

  const secret = decryptSecret(security.pendingEncryptedSecret);
  const ok = verifyAuthenticatorCode(secret, code);
  if (!ok) return { ok: false, reason: "Invalid authenticator code" };

  const recoveryCodes = generateRecoveryCodes();
  security.isEnabled = true;
  security.encryptedSecret = security.pendingEncryptedSecret;
  security.pendingEncryptedSecret = undefined;
  security.pendingSecretExpiresAt = undefined;
  security.recoveryCodes = await hashRecoveryCodes(recoveryCodes);
  security.lastVerifiedAt = new Date();
  await security.save();

  return { ok: true, recoveryCodes };
}

export async function startTotpRotation(
  userId: string,
  email: string,
  currentPassword: string,
  currentCode: string
) {
  await connectDB();
  const passwordOk = await requireCurrentPassword(userId, currentPassword);
  if (!passwordOk) return { ok: false, reason: "Current password is incorrect" };

  const security = await LogSecurity.findOne({ user: userId });
  if (!security?.isEnabled || !security.encryptedSecret) {
    return { ok: false, reason: "Authenticator setup is required" };
  }

  const currentSecret = decryptSecret(security.encryptedSecret);
  const currentOk = verifyAuthenticatorCode(currentSecret, currentCode);
  if (!currentOk) return { ok: false, reason: "Invalid authenticator code" };

  const secret = generateSecret();
  const { label, otpauth } = createTotpSetupPayload(email, secret);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauth);
  security.pendingEncryptedSecret = encryptSecret(secret);
  security.pendingSecretExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await security.save();

  return { ok: true, label, secret, qrCodeDataUrl };
}

export async function confirmTotpRotation(userId: string, code: string) {
  await connectDB();
  const security = await LogSecurity.findOne({ user: userId });
  if (!security?.isEnabled || !security.encryptedSecret) {
    return { ok: false, reason: "Authenticator setup is required" };
  }
  if (!security.pendingEncryptedSecret || !security.pendingSecretExpiresAt) {
    return { ok: false, reason: "No pending rotation was found" };
  }
  if (new Date(security.pendingSecretExpiresAt) <= new Date()) {
    return { ok: false, reason: "Rotation expired. Start again to get a fresh QR code." };
  }

  const pendingSecret = decryptSecret(security.pendingEncryptedSecret);
  const ok = verifyAuthenticatorCode(pendingSecret, code);
  if (!ok) return { ok: false, reason: "Invalid authenticator code" };

  const recoveryCodes = generateRecoveryCodes();
  security.encryptedSecret = security.pendingEncryptedSecret;
  security.pendingEncryptedSecret = undefined;
  security.pendingSecretExpiresAt = undefined;
  security.recoveryCodes = await hashRecoveryCodes(recoveryCodes);
  security.lastVerifiedAt = new Date();
  await Promise.all([
    security.save(),
    LogUnlockSession.deleteMany({ user: userId }),
  ]);

  return { ok: true, recoveryCodes };
}

export async function verifyTotp(
  userId: string,
  sessionJti: string,
  code: string,
  deviceUnlockId: string,
  userAgent: string
) {
  await connectDB();
  if (!validateDeviceUnlockId(deviceUnlockId)) {
    return { ok: false, reason: "Invalid device unlock id" };
  }

  const security = await LogSecurity.findOne({ user: userId });
  if (!security?.isEnabled || !security.encryptedSecret) {
    return { ok: false, reason: "Authenticator setup is required" };
  }

  const secret = decryptSecret(security.encryptedSecret);
  const ok = verifyAuthenticatorCode(secret, code);
  if (!ok) return { ok: false, reason: "Invalid authenticator code" };

  const expiresAt = new Date(Date.now() + LOG_UNLOCK_MINUTES * 60 * 1000);
  security.lastVerifiedAt = new Date();
  await Promise.all([
    security.save(),
    LogUnlockSession.findOneAndUpdate(
      { user: userId, sessionJti },
      {
        $set: {
          deviceHash: hashDeviceUnlockId(userId, sessionJti, deviceUnlockId),
          expiresAt,
          userAgentHash: hashUserAgent(userAgent),
        },
      },
      { upsert: true, new: true }
    ),
  ]);

  return { ok: true, expiresAt };
}

export async function useRecoveryCode(
  userId: string,
  sessionJti: string,
  code: string,
  deviceUnlockId: string,
  userAgent: string
) {
  await connectDB();
  if (!validateDeviceUnlockId(deviceUnlockId)) {
    return { ok: false, reason: "Invalid device unlock id" };
  }

  const security = await LogSecurity.findOne({ user: userId });
  if (!security?.isEnabled) return { ok: false, reason: "Authenticator setup is required" };

  const normalized = normalizeOtp(code).toUpperCase();
  const recoveryCodes = security.recoveryCodes ?? [];
  for (let index = 0; index < recoveryCodes.length; index += 1) {
    const recovery = recoveryCodes[index];
    if (!recovery.usedAt && await bcrypt.compare(normalized, recovery.hash)) {
      recovery.usedAt = new Date();
      const expiresAt = new Date(Date.now() + LOG_UNLOCK_MINUTES * 60 * 1000);
      await Promise.all([
        security.save(),
        LogUnlockSession.findOneAndUpdate(
          { user: userId, sessionJti },
          {
            $set: {
              deviceHash: hashDeviceUnlockId(userId, sessionJti, deviceUnlockId),
              expiresAt,
              userAgentHash: hashUserAgent(userAgent),
            },
          },
          { upsert: true, new: true }
        ),
      ]);
      return { ok: true, expiresAt };
    }
  }

  return { ok: false, reason: "Invalid recovery code" };
}

export async function regenerateRecoveryCodes(
  userId: string,
  currentPassword: string,
  currentCode: string
) {
  await connectDB();
  const passwordOk = await requireCurrentPassword(userId, currentPassword);
  if (!passwordOk) return { ok: false, reason: "Current password is incorrect" };

  const security = await LogSecurity.findOne({ user: userId });
  if (!security?.isEnabled || !security.encryptedSecret) {
    return { ok: false, reason: "Authenticator setup is required" };
  }

  const secret = decryptSecret(security.encryptedSecret);
  const ok = verifyAuthenticatorCode(secret, currentCode);
  if (!ok) return { ok: false, reason: "Invalid authenticator code" };

  const recoveryCodes = generateRecoveryCodes();
  security.recoveryCodes = await hashRecoveryCodes(recoveryCodes);
  await Promise.all([
    security.save(),
    LogUnlockSession.deleteMany({ user: userId }),
  ]);

  return { ok: true, recoveryCodes };
}

export async function disableTotp(userId: string, currentPassword: string, currentCode: string) {
  await connectDB();
  const passwordOk = await requireCurrentPassword(userId, currentPassword);
  if (!passwordOk) return { ok: false, reason: "Current password is incorrect" };

  const security = await LogSecurity.findOne({ user: userId });
  if (!security?.isEnabled || !security.encryptedSecret) {
    return { ok: false, reason: "Authenticator setup is required" };
  }

  const secret = decryptSecret(security.encryptedSecret);
  const ok = verifyAuthenticatorCode(secret, currentCode);
  if (!ok) return { ok: false, reason: "Invalid authenticator code" };

  security.isEnabled = false;
  security.encryptedSecret = undefined;
  security.pendingEncryptedSecret = undefined;
  security.pendingSecretExpiresAt = undefined;
  security.recoveryCodes = [];
  await Promise.all([
    security.save(),
    LogUnlockSession.deleteMany({ user: userId }),
  ]);

  return { ok: true };
}

export async function isLogsUnlocked(
  userId: string,
  sessionJti?: string | null,
  deviceUnlockId?: string | null,
  userAgent = ""
) {
  if (!sessionJti || !deviceUnlockId || !validateDeviceUnlockId(deviceUnlockId)) return false;
  await connectDB();
  const unlock = await LogUnlockSession.findOne({
    user: userId,
    sessionJti,
    deviceHash: hashDeviceUnlockId(userId, sessionJti, deviceUnlockId),
    userAgentHash: hashUserAgent(userAgent),
    expiresAt: { $gt: new Date() },
  }).lean();
  return Boolean(unlock);
}

export async function lockCurrentLogs(userId: string, sessionJti: string, deviceUnlockId: string) {
  if (!validateDeviceUnlockId(deviceUnlockId)) return;
  await connectDB();
  await LogUnlockSession.deleteOne({
    user: userId,
    sessionJti,
    deviceHash: hashDeviceUnlockId(userId, sessionJti, deviceUnlockId),
  });
}

export async function revokeAllLogUnlocks(userId: string) {
  await connectDB();
  await LogUnlockSession.deleteMany({ user: userId });
}
