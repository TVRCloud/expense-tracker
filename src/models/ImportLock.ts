import { Schema, model, models } from "mongoose";

// One live CSV import per user and account. The unique index is the lock: a
// second commit while one runs fails its insert instead of racing the first
// one's duplicate check. The TTL frees the lock if the function was killed.
const ImportLockSchema = new Schema(
  {
    user: { type: String, required: true },
    account: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

ImportLockSchema.index({ user: 1, account: 1 }, { unique: true });
ImportLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default models.ImportLock || model("ImportLock", ImportLockSchema, "import_locks");
