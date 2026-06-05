export type UserRole = "user" | "admin";
export type AccountType = "cash" | "bank" | "credit_card" | "savings" | "investment" | "wallet";
export type TransactionType = "income" | "expense" | "transfer";
export type LoanDirection = "given" | "received";
export type NotificationType =
  | "budget_alert"
  | "loan_due"
  | "goal_reached"
  | "system"
  | "transaction";

export interface UserPreferences {
  theme: "light" | "dark" | "system";
  language: string;
  pushNotifications: boolean;
  emailNotifications: boolean;
  weekStartsOn: 0 | 1;
  currency: string;
}

export interface IUser {
  _id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string | null;
  currency: string;
  isActive: boolean;
  preferences: UserPreferences;
  createdAt: string;
  updatedAt: string;
}

export interface IAccount {
  _id: string;
  user: string;
  name: string;
  type: AccountType;
  balance: number; // cents
  currency: string;
  color?: string;
  icon?: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ITransaction {
  _id: string;
  user: string;
  account: string | IAccount;
  type: TransactionType;
  amount: number; // cents, always positive
  currency: string;
  category: string;
  subcategory?: string;
  description?: string;
  note?: string;
  date: string;
  tags: string[];
  attachments: string[];
  transferTo?: string | IAccount;
  isRecurring: boolean;
  recurrenceFrequency?: "daily" | "weekly" | "monthly" | "yearly";
  recurrenceInterval?: number;
  recurrenceCount?: number;
  recurrenceEndDate?: string;
  recurrenceLabel?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IBudget {
  _id: string;
  user: string;
  category: string;
  month: number;
  year: number;
  limitAmount: number; // cents
  currency: string;
  alertAt: number; // percent
  isActive: boolean;
  spent?: number; // cents — computed
  createdAt: string;
  updatedAt: string;
}

export interface ILoan {
  _id: string;
  user: string;
  direction: LoanDirection;
  counterparty: string;
  principalAmount: number; // cents
  remainingAmount: number; // cents
  currency: string;
  interestRate?: number;
  startDate: string;
  dueDate?: string;
  description?: string;
  isSettled: boolean;
  settledAt?: string;
  account?: string | IAccount;
  createdAt: string;
  updatedAt: string;
}

export interface IRepayment {
  _id: string;
  loan: string;
  user: string;
  amount: number; // cents
  date: string;
  note?: string;
  account?: string | IAccount;
  createdAt: string;
  updatedAt: string;
}

export interface IGoal {
  _id: string;
  user: string;
  name: string;
  targetAmount: number; // cents
  savedAmount: number; // cents
  currency: string;
  targetDate?: string;
  category?: string;
  icon?: string;
  color?: string;
  linkedAccount?: string | IAccount;
  isCompleted: boolean;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface INotification {
  _id: string;
  user: string;
  type: NotificationType;
  title: string;
  body: string;
  meta?: Record<string, unknown>;
  isRead: boolean;
  readAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IPushSubscription {
  _id: string;
  user: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionStats {
  income: number; // cents
  expense: number; // cents
  net: number; // cents
  byCategory: Array<{ category: string; total: number }>;
  dailyAverage: number; // cents
}
