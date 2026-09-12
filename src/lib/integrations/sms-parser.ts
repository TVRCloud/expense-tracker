// Parses bank/NBFC transactional SMS text into structured data. Lives here
// (not inside the n8n workflow) so it's versioned with the codebase, unit
// testable, and reused unchanged by a future phone app that auto-fetches SMS
// — n8n and that app both just POST raw text to /api/integrations/sms.
//
// Each bank/service phrases these differently; add a new entry to PARSERS
// as new formats show up rather than generalizing prematurely. A message
// that matches no parser resolves to `{ kind: "unknown" }` and the caller
// queues it for manual review instead of guessing.

export interface CreditCardSpendSms {
  kind: "credit_card_spend";
  amountMinor: number; // paise
  currency: "INR";
  cardLast4: string;
  bankName: string;
  merchant: string;
  date: Date;
}

export interface LoanEmiPaymentSms {
  kind: "loan_emi_payment";
  amountMinor: number; // paise
  currency: "INR";
  lenderName: string;
  externalLoanId: string;
  period?: string;
}

export interface UnknownSms {
  kind: "unknown";
}

export type ParsedSms = CreditCardSpendSms | LoanEmiPaymentSms | UnknownSms;

/** "3,980" / "896.15" / "10,309.48" -> 398000 / 89615 / 1030948 (paise). */
function toMinorUnits(amountText: string): number {
  const rupees = Number.parseFloat(amountText.replace(/,/g, ""));
  return Math.round(rupees * 100);
}

const MONTH_NAMES = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";

interface ParserDef {
  id: string;
  parse(text: string): ParsedSms | null;
}

const PARSERS: ParserDef[] = [
  {
    // "Payment Successful: Advance EMI of Rs.3,980/- received towards Navi
    // Finserv loan account 010021753351 for October 2026."
    id: "loan_emi_payment",
    parse(text) {
      const match = text.match(
        /Rs\.?\s*([\d,]+(?:\.\d+)?)\s*\/?-?\s+received towards\s+(.+?)\s+loan account\s+(\w+)(?:\s+for\s+([A-Za-z]+ \d{4}))?/i
      );
      if (!match) return null;
      const [, amountText, lenderName, externalLoanId, period] = match;
      return {
        kind: "loan_emi_payment",
        amountMinor: toMinorUnits(amountText),
        currency: "INR",
        lenderName: lenderName.trim(),
        externalLoanId,
        period: period?.trim(),
      };
    },
  },
  {
    // "Happy Shopping! INR 896.15 spent on your IDFC FIRST Bank Credit Card
    // ending XX1832 at PAYPAL *XINDAWNCOMP on 24 JUN 2026 at 04:04 PM
    // Avbl Limit: INR 10309.48 ..."
    id: "credit_card_spend",
    parse(text) {
      const match = text.match(
        new RegExp(
          `INR\\s*([\\d,]+(?:\\.\\d+)?)\\s*spent on your\\s+(.+?)\\s+Credit Card ending\\s*(?:XX)?(\\d{4})\\s+at\\s+(.+?)\\s+on\\s+(\\d{1,2}\\s+(?:${MONTH_NAMES})\\s+\\d{4})`,
          "i"
        )
      );
      if (!match) return null;
      const [, amountText, bankName, cardLast4, merchant, dateText] = match;
      const date = new Date(`${dateText} UTC`);
      return {
        kind: "credit_card_spend",
        amountMinor: toMinorUnits(amountText),
        currency: "INR",
        cardLast4,
        bankName: bankName.trim(),
        merchant: merchant.trim(),
        date: Number.isNaN(date.getTime()) ? new Date() : date,
      };
    },
  },
];

export function parseBankSms(text: string): ParsedSms {
  for (const parser of PARSERS) {
    const result = parser.parse(text);
    if (result) return result;
  }
  return { kind: "unknown" };
}
