import {
  Banknote,
  Landmark,
  CreditCard,
  PiggyBank,
  TrendingUp,
  Wallet,
  ShoppingCart,
  Car,
  Home,
  Heart,
  ShoppingBag,
  Coffee,
  GraduationCap,
  Popcorn,
  Dumbbell,
  Plane,
  Repeat,
  RotateCcw,
  ArrowLeftRight,
  HelpCircle,
  AlertTriangle,
  CalendarClock,
  Target,
  Megaphone,
  Receipt,
  Clock,
  CheckCircle2,
  Sun,
  Coins,
  type LucideIcon,
} from "lucide-react";
import type { AccountType, NotificationType, StatementStatus } from "@/types/models";

export const ACCOUNT_TYPE_ICONS: Record<AccountType, LucideIcon> = {
  cash: Banknote,
  bank: Landmark,
  credit_card: CreditCard,
  savings: PiggyBank,
  investment: TrendingUp,
  wallet: Wallet,
};

// Canonical category taxonomy — matches AddTransactionForm/BudgetsClient, not the stale set
// that used to live in TransactionRow (which had `car`/`internet` and no `transport`/`entertainment`/`emi`/`transfer`).
export const TRANSACTION_CATEGORY_ICONS: Record<string, LucideIcon> = {
  groceries: ShoppingCart,
  transport: Car,
  rent: Home,
  health: Heart,
  shopping: ShoppingBag,
  coffee: Coffee,
  education: GraduationCap,
  entertainment: Popcorn,
  gym: Dumbbell,
  travel: Plane,
  subscription: Repeat,
  emi: RotateCcw,
  income: TrendingUp,
  transfer: ArrowLeftRight,
  other: HelpCircle,
};

export const NOTIFICATION_TYPE_ICONS: Record<NotificationType, LucideIcon> = {
  budget_alert: AlertTriangle,
  loan_due: CalendarClock,
  goal_reached: Target,
  system: Megaphone,
  transaction: Receipt,
  credit_due: CreditCard,
  credit_overdue: AlertTriangle,
  emi_due: RotateCcw,
};

export const NOTIFICATION_TYPE_COLORS: Record<NotificationType, string> = {
  budget_alert: "var(--amber)",
  loan_due: "var(--amber)",
  goal_reached: "var(--green)",
  system: "var(--ink-2)",
  transaction: "var(--violet)",
  credit_due: "var(--amber)",
  credit_overdue: "var(--red)",
  emi_due: "var(--violet)",
};

export const STATEMENT_STATUS_ICONS: Record<StatementStatus, LucideIcon> = {
  open: Clock,
  closed: CheckCircle2,
  paid: CheckCircle2,
  overdue: AlertTriangle,
};

export const APPEARANCE_ICON = Sun;
export const ACCOUNTS_NAV_ICON = Wallet;
export const CURRENCY_ICON = Coins;
