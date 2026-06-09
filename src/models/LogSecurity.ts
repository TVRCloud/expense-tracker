import { Schema, model, models } from "mongoose";

const EncryptedSecretSchema = new Schema(
  {
    iv: { type: String, required: true },
    tag: { type: String, required: true },
    ciphertext: { type: String, required: true },
  },
  { _id: false }
);

const RecoveryCodeSchema = new Schema(
  {
    hash: { type: String, required: true },
    usedAt: { type: Date },
  },
  { _id: false }
);

const LogSecuritySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    isEnabled: { type: Boolean, default: false },
    encryptedSecret: { type: EncryptedSecretSchema },
    pendingEncryptedSecret: { type: EncryptedSecretSchema },
    pendingSecretExpiresAt: { type: Date },
    recoveryCodes: [RecoveryCodeSchema],
    lastVerifiedAt: { type: Date },
  },
  { timestamps: true }
);

LogSecuritySchema.index({ user: 1, isEnabled: 1 });
LogSecuritySchema.index({ pendingSecretExpiresAt: 1 });

export default models.LogSecurity || model("LogSecurity", LogSecuritySchema, "log_security");
