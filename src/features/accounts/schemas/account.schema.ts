import { z } from "zod";

// Single source of truth for account-create validation — imported by both
// the client form (AccountsClient.tsx, via react-hook-form) and the server
// route (src/app/api/accounts/route.ts), so client and server enforce
// identical rules.
export const creditMetaSchema = z.object({
  creditLimit: z.number().int().positive().optional(),
  billingCycleDay: z.number().int().min(1).max(31).optional(),
  paymentDueDay: z.number().int().min(1).max(31).optional(),
  apr: z.number().min(0).max(100).optional(),
  network: z.enum(["visa", "mastercard", "amex", "rupay", "discover", "diners"]).optional(),
  lastFourDigits: z.string().length(4).regex(/^\d{4}$/).optional(),
  cardholderName: z.string().max(60).optional(),
  minPaymentPct: z.number().min(0).max(100).optional(),
});

export const accountCreateSchema = z.object({
  name: z.string().min(1, "Name your account").max(100),
  type: z.enum(["cash", "bank", "credit_card", "savings", "investment", "wallet"]),
  balance: z.number().int().default(0),
  currency: z.string().default("INR"),
  color: z.string().optional(),
  icon: z.string().optional(),
  creditMeta: creditMetaSchema.optional(),
});

export type AccountCreateInput = z.infer<typeof accountCreateSchema>;
