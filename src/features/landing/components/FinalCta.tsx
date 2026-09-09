import Link from "next/link";
import { Button } from "@/components/_ui/Button";
import { Card } from "@/components/_ui/Card";

export function FinalCta() {
  return (
    <section className="px-6 pb-24">
      <Card
        as="div"
        radius="lg"
        elevation="floating"
        className="mx-auto flex flex-col items-center gap-3 p-10 text-center"
        style={{ maxWidth: "var(--maxw)" }}
      >
        <h2 className="text-2xl font-bold" style={{ color: "var(--ink)" }}>
          Track your expenses, budgets, loans, and savings goals.
        </h2>
        <Button asChild size="lg" className="mt-3">
          <Link href="/register">Get started</Link>
        </Button>
        <p className="text-sm" style={{ color: "var(--ink-3)" }}>
          Already have an account?{" "}
          <Link href="/login" className="font-semibold" style={{ color: "var(--ink-2)" }}>
            Sign in
          </Link>
        </p>
      </Card>
    </section>
  );
}
