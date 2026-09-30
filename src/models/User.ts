import { Schema, model, models } from "mongoose";

const UserSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    avatar: { type: String },
    currency: { type: String, default: "INR" },
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
      currency: { type: String, default: "INR" },
    },
    passwordResetToken: { type: String },
    passwordResetExpires: { type: Date },
  },
  { timestamps: true }
);

UserSchema.index({ role: 1 });

export default models.User || model("User", UserSchema, "users");
