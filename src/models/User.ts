import { Schema, model, models } from "mongoose";

const UserSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    avatar: { type: String },
    currency: { type: String, default: "INR" },
    // Set the first time a money row (transaction, balance, budget, goal, loan,
    // fund, asset, limit) is written: from then on the base currency cannot
    // change (src/lib/base-currency.ts). Absent on accounts that never had one.
    baseLocked: { type: Boolean },
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date },
    // Original address of a self-deleted account; `email` itself is rewritten
    // to a tombstone so the unique index frees the address for re-registration.
    deletedEmail: { type: String, lowercase: true },
    preferences: {
      theme: { type: String, enum: ["light", "dark", "system"], default: "system" },
      glassIntensity: { type: String, enum: ["subtle", "full"], default: "subtle" },
      language: { type: String, default: "en" },
      pushNotifications: { type: Boolean, default: true },
      emailNotifications: { type: Boolean, default: true },
      weekStartsOn: { type: Number, default: 0 },
      // IANA zone that decides where a "day" starts for spend limits.
      timezone: { type: String, default: "Asia/Kolkata" },
      currency: { type: String, default: "INR" },
      // Bill reminders (src/lib/bill-reminders.ts): off until the user turns them on.
      billReminders: {
        enabled: { type: Boolean, default: false },
        leadDays: { type: Number, default: 3, min: 1, max: 14 },
      },
      // Weekly review notification (src/lib/weekly-review.ts): off until the
      // user turns it on. `day` is the weekday it arrives, 0 Sunday to 6 Saturday.
      weeklyReview: {
        enabled: { type: Boolean, default: false },
        day: { type: Number, default: 1, min: 0, max: 6 },
      },
      // Tax helper (src/lib/tax-settings.ts): lower-case category names whose
      // spending counts as deductible in the financial-year summary.
      tax: {
        deductibleCategories: [{ type: String }],
      },
      // Envelope mode (src/lib/envelope-service.ts): zero-based budgeting on top
      // of budgets, off until the user turns it on.
      envelopes: {
        enabled: { type: Boolean, default: false },
      },
    },
    passwordResetToken: { type: String },
    passwordResetExpires: { type: Date },
  },
  { timestamps: true }
);

UserSchema.index({ role: 1 });

export default models.User || model("User", UserSchema, "users");
