import { Repeat, HandCoins, CreditCard, ShieldCheck, Activity, WifiOff, type LucideIcon } from "lucide-react";
import { Card } from "@/components/_ui/Card";
import { StaggerContainer, StaggerItem } from "@/components/shared/StaggerContainer";

interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
}

const FEATURES: Feature[] = [
  {
    icon: Repeat,
    title: "Split transactions & recurring bills",
    description:
      "Log a purchase in seconds, split it across categories, and set up recurring bills or EMIs once instead of re-entering them every month.",
  },
  {
    icon: HandCoins,
    title: "Loans, with interest and due dates",
    description:
      "Track money lent or borrowed — with interest and a due date — and log repayments over time, so informal loans don't get forgotten.",
  },
  {
    icon: CreditCard,
    title: "Credit card pay-now",
    description:
      "See your card's statement, utilization, and upcoming EMI commitments, and pay it off — in full, minimum, or a custom amount — without leaving the app.",
  },
  {
    icon: ShieldCheck,
    title: "Tamper-evident audit log",
    description:
      "Every change to your finances is recorded in a hash-chained log, protected behind a second-factor unlock — so nothing gets silently altered.",
  },
  {
    icon: Activity,
    title: "Real-time balances",
    description:
      "See your net worth, this month's income and spend, and your accounts the moment you open the app — live, no refresh needed.",
  },
  {
    icon: WifiOff,
    title: "Installable, works offline",
    description:
      "Install it like an app and keep using it — a clear offline state instead of a broken blank screen when your connection drops.",
  },
];

export function FeatureGrid() {
  return (
    <section className="px-6 pb-20">
      <StaggerContainer
        className="mx-auto grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        style={{ maxWidth: "var(--maxw)" }}
      >
        {FEATURES.map(({ icon: Icon, title, description }) => (
          <StaggerItem key={title}>
            <Card as="article" elevation="raised" className="h-full p-6">
              <Icon className="h-6 w-6" style={{ color: "var(--ink)" }} aria-hidden />
              <h3 className="mt-4 font-semibold" style={{ color: "var(--ink)" }}>
                {title}
              </h3>
              <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
                {description}
              </p>
            </Card>
          </StaggerItem>
        ))}
      </StaggerContainer>
    </section>
  );
}
