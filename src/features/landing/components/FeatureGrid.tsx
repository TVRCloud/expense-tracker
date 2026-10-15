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

// Bento spans on a 6-col grid (lg): 4+2 / 2+2+2 / 6.
const SPANS = ["lg:col-span-4", "lg:col-span-2", "lg:col-span-2", "lg:col-span-2", "lg:col-span-2", "lg:col-span-6"];

export function FeatureGrid() {
  return (
    <section className="px-5 pb-20 sm:px-8 md:pb-28">
      <div className="mx-auto mb-10 max-w-3xl text-center md:mb-14">
        <h2
          className="font-bold"
          style={{ color: "var(--ink)", fontSize: "clamp(1.9rem, 4.5vw, 3.25rem)", lineHeight: 1.05, letterSpacing: "-0.03em" }}
        >
          Everything in its place.
        </h2>
        <p className="mt-4 text-base md:text-lg" style={{ color: "var(--ink-2)" }}>
          Built for the details of real money: splits, EMIs, statements and a trail you can trust.
        </p>
      </div>
      <StaggerContainer
        className="mx-auto grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-6"
        style={{ maxWidth: "var(--maxw)" }}
      >
        {FEATURES.map(({ icon: Icon, title, description }, i) => (
          <StaggerItem key={title} className={SPANS[i]}>
            <Card as="article" radius="lg" elevation="raised" className="h-full p-6 md:p-8">
              <div
                className="grid size-11 place-items-center rounded-(--r-sm)"
                style={{ background: "var(--violet)", color: "var(--violet-fg)" }}
              >
                <Icon className="size-5" aria-hidden />
              </div>
              <h3
                className="mt-5 text-lg font-semibold md:text-xl"
                style={{ color: "var(--ink)", letterSpacing: "-0.015em" }}
              >
                {title}
              </h3>
              <p className="mt-2 max-w-xl text-[15px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
                {description}
              </p>
            </Card>
          </StaggerItem>
        ))}
      </StaggerContainer>
    </section>
  );
}
