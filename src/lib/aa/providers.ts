import type { AaProvider } from "@/lib/aa/provider";
import { sandboxProvider } from "@/lib/aa/sandbox";

// The registry of Account Aggregator providers, picked by the AA_PROVIDER env
// var. Unset (or an unknown name) means the feature is off: getAaProvider()
// returns null and every AA endpoint answers AA_NOT_CONFIGURED.
//
// To go live, implement AaProvider in a new file in this folder (src/lib/aa/)
// and add it here under its name. Credentials for it belong in env vars that
// only that file reads. See docs/security.md, "Account Aggregator".
const PROVIDERS: Readonly<Record<string, AaProvider>> = {
  sandbox: sandboxProvider,
};

export function getAaProvider(): AaProvider | null {
  const name = process.env.AA_PROVIDER?.trim().toLowerCase();
  if (!name) return null;
  return Object.prototype.hasOwnProperty.call(PROVIDERS, name) ? PROVIDERS[name] : null;
}

export function aaConfigured(): boolean {
  return getAaProvider() !== null;
}

/** The provider a stored consent was made with, if it is still registered. */
export function providerByName(name: string): AaProvider | null {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, name) ? PROVIDERS[name] : null;
}
