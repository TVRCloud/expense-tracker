import type { AaProvider } from "@/lib/aa/provider";
import { sandboxProvider } from "@/lib/aa/sandbox";

// The registry of Account Aggregator providers, picked by the AA_PROVIDER env
// var. Unset (or an unknown name) means the feature is off: getAaProvider()
// returns null and every AA endpoint answers AA_NOT_CONFIGURED.
//
// To go live, implement AaProvider in a new file in this folder (src/lib/aa/)
// and add it here under its name. Credentials for it belong in env vars that
// only that file reads. See docs/account-aggregator.md, "Going live".
const PROVIDERS: Readonly<Record<string, AaProvider>> = {
  sandbox: sandboxProvider,
};

// The sandbox is a fake that keeps state in memory and never reaches a bank. In production it is refused unless
// AA_ALLOW_SANDBOX=true is set on purpose (a demo server), so a stray AA_PROVIDER=sandbox cannot switch on a fake
// bank link for real users.
function allowed(name: string): boolean {
  if (name === "sandbox" && process.env.NODE_ENV === "production" && process.env.AA_ALLOW_SANDBOX !== "true") return false;
  return true;
}

export function getAaProvider(): AaProvider | null {
  const name = process.env.AA_PROVIDER?.trim().toLowerCase();
  if (!name) return null;
  if (!Object.prototype.hasOwnProperty.call(PROVIDERS, name) || !allowed(name)) return null;
  return PROVIDERS[name];
}

export function aaConfigured(): boolean {
  return getAaProvider() !== null;
}

/** The provider a stored consent was made with, if it is still registered and allowed. */
export function providerByName(name: string): AaProvider | null {
  if (!Object.prototype.hasOwnProperty.call(PROVIDERS, name) || !allowed(name)) return null;
  return PROVIDERS[name];
}
