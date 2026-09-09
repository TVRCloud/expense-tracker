import { PageTransition } from "@/components/shared/PageTransition";
import { Hero } from "./Hero";
import { FeatureGrid } from "./FeatureGrid";
import { FinalCta } from "./FinalCta";

export function LandingPage() {
  return (
    <PageTransition>
      <Hero />
      <FeatureGrid />
      <FinalCta />
    </PageTransition>
  );
}
