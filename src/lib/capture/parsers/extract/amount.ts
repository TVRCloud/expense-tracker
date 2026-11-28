// The money figure of a message: its amount and currency, skipping balance and limit figures.

// Rupees, plus the currencies a card is most often charged in abroad. All of these have two decimals, so the
// figure times 100 is its minor units.
const FOREIGN = "USD|EUR|GBP|AED|SGD|AUD|CAD|CHF|HKD|NZD|SAR|QAR|THB|MYR";
const AMOUNT = String.raw`(?:(Rs\.?|INR|₹|${FOREIGN}|US\$|\$|€|£)\s*([\d,]+(?:\.\d{1,2})?))`;

export interface FoundAmount {
  minor: number;
  index: number;
  currency: string;
}

/** Currency symbol or code as written -> ISO code. */
function currencyOf(token: string): string {
  const t = token.toUpperCase().replace(/\.$/, "");
  if (t === "RS" || t === "INR" || t === "₹") return "INR";
  if (t === "US$" || t === "$") return "USD";
  if (t === "€") return "EUR";
  if (t === "£") return "GBP";
  return t;
}

/** "3,980" / "896.15" -> 398000 / 89615 (paise). */
export function toMinorUnits(amountText: string): number {
  return Math.round(Number.parseFloat(amountText.replace(/,/g, "")) * 100);
}

/** First amount in the text that isn't a balance or limit figure. */
export function findAmount(text: string): FoundAmount | null {
  const withCurrency = findCurrencyAmount(text);
  if (withCurrency) return withCurrency;
  // SBI-style, no currency token: "A/c X1234 debited by 250.0 on date 26Sep26"
  const bare = text.match(/\b(?:debited|credited)\s+(?:by|for|with)\s+([\d,]+(?:\.\d{1,2})?)\b/i);
  if (bare) {
    const minor = toMinorUnits(bare[1]);
    if (minor > 0) return { minor, index: bare.index ?? 0, currency: "INR" };
  }
  return null;
}

function findCurrencyAmount(text: string): FoundAmount | null {
  const re = new RegExp(AMOUNT, "gi");
  let foreign: FoundAmount | null = null;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const before = text.slice(Math.max(0, m.index - 22), m.index);
    if (/(bal(ance)?|limit|lmt|avl|avbl|available|outstanding|due)[\s:.-]*(is|of)?[\s:.-]*$/i.test(before)) continue;
    const minor = toMinorUnits(m[2]);
    if (minor <= 0) continue;
    const currency = currencyOf(m[1]);
    // A spend abroad that also states what was billed in rupees ("$25.00 at STEAM (INR 2,150.00)"): the rupees win.
    if (currency === "INR") return { minor, index: m.index, currency };
    foreign ??= { minor, index: m.index, currency };
  }
  return foreign;
}
