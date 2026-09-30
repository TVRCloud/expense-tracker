import { Types } from "mongoose";
import Account from "@/models/Account";
import CapturedMessage from "@/models/CapturedMessage";
import logger from "@/lib/logger";

// Which of the user's accounts a bank message belongs to.
//
// 1. Saved digits: the account's "SMS match digits" (smsLastFour) or a
//    card's last four. Exactly one hit wins; two accounts with the same
//    digits is ambiguous and never guessed.
// 2. No saved digits match: the bank (from the text, e.g. "HDFC Bank", or
//    the sender code, e.g. VM-HDFCBK) plus the instrument ("A/C" is a bank
//    account, "Card" is a credit card) narrow the user's accounts. If
//    exactly one account of that bank and kind is left, and it has no
//    other digits saved (which would mean this is a different account at
//    the same bank), it is used. Captured transactions always land in
//    Needs review, so the guess is checked by the user, and confirming it
//    saves the digits (learnDigitsFromCapture) so the next message matches
//    in step 1.

type BankKey =
  | "HDFC" | "ICICI" | "SBI" | "AXIS" | "KOTAK" | "IDFC" | "YES" | "INDUSIND"
  | "PNB" | "BARODA" | "CANARA" | "UNION" | "FEDERAL" | "AU" | "RBL";

// How each bank appears in account names people type.
const NAME_ALIASES: Record<BankKey, RegExp> = {
  HDFC: /\bHDFC\b/,
  ICICI: /\bICICI\b/,
  SBI: /\bSBI\b|\bSTATE BANK\b/,
  AXIS: /\bAXIS\b/,
  KOTAK: /\bKOTAK\b/,
  IDFC: /\bIDFC\b/,
  YES: /\bYES ?BANK\b/,
  INDUSIND: /\bINDUS ?IND\b/,
  PNB: /\bPNB\b|\bPUNJAB NATIONAL\b/,
  BARODA: /\bBOB\b|\bBARODA\b/,
  CANARA: /\bCANARA\b/,
  UNION: /\bUNION BANK\b|\bUBI\b/,
  FEDERAL: /\bFEDERAL\b/,
  AU: /\bAU\b/,
  RBL: /\bRBL\b/,
};

// Parsed bank name ("HDFC Bank", "Bank of Baroda", "IDFC FIRST") to key.
function keyFromBankName(bankName?: string): BankKey | undefined {
  if (!bankName) return undefined;
  const n = bankName.toUpperCase();
  if (n.includes("BARODA") || /^BOB\b/.test(n)) return "BARODA";
  if (n.startsWith("INDUSIND")) return "INDUSIND";
  const first = n.split(/\s+/)[0] as BankKey;
  return first in NAME_ALIASES ? first : undefined;
}

// DLT sender IDs look like "VM-HDFCBK", "AD-ICICIB", "JD-SBIINB".
const SENDER_CODES: Array<[RegExp, BankKey]> = [
  [/HDFC/, "HDFC"],
  [/ICICI/, "ICICI"],
  [/SBI/, "SBI"],
  [/AXIS/, "AXIS"],
  [/KOTAK/, "KOTAK"],
  [/IDFC/, "IDFC"],
  [/YESB/, "YES"],
  [/INDUS/, "INDUSIND"],
  [/PNB/, "PNB"],
  [/BOB|BARODA/, "BARODA"],
  [/CANBNK|CANARA/, "CANARA"],
  [/UBOI|UNION/, "UNION"],
  [/FEDBNK|FEDERAL/, "FEDERAL"],
  [/AUBANK|AUSFB/, "AU"],
  [/RBL/, "RBL"],
];

function keyFromSender(sender?: string): BankKey | undefined {
  if (!sender) return undefined;
  const code = sender.toUpperCase().replace(/^[A-Z]{2}-/, "");
  return SENDER_CODES.find(([re]) => re.test(code))?.[1];
}

export function bankKeyOf(bankName?: string, sender?: string): BankKey | undefined {
  return keyFromBankName(bankName) ?? keyFromSender(sender);
}

type AccountRow = {
  _id: Types.ObjectId;
  name: string;
  type: string;
  smsLastFour?: string[];
  creditMeta?: { lastFourDigits?: string };
};

const kindMatches = (a: AccountRow, instrument?: "card" | "account") =>
  instrument === "card" ? a.type === "credit_card" : instrument === "account" ? a.type === "bank" || a.type === "savings" : true;

const hasOtherDigits = (a: AccountRow) => (a.smsLastFour?.length ?? 0) > 0 || Boolean(a.creditMeta?.lastFourDigits);

export type AccountMatch = {
  accountId: string | null;
  /** How accountId was found; null when not matched. */
  matchedBy: "digits" | "bank" | null;
  /** Best guess to preselect when the message is queued (not auto-used). */
  suggestedAccountId: string | null;
};

export async function matchAccountForMessage(
  userId: string,
  msg: { last4?: string; bankName?: string; instrument?: "card" | "account"; sender?: string }
): Promise<AccountMatch> {
  const none: AccountMatch = { accountId: null, matchedBy: null, suggestedAccountId: null };
  if (!msg.last4) return none;

  const byDigits = await Account.find({
    user: userId,
    isArchived: { $ne: true },
    $or: [{ smsLastFour: msg.last4 }, { "creditMeta.lastFourDigits": msg.last4 }],
  })
    .select("_id")
    .limit(2)
    .lean<{ _id: Types.ObjectId }[]>();
  // Two accounts with the same last four digits: don't guess.
  if (byDigits.length === 1) return { accountId: byDigits[0]._id.toString(), matchedBy: "digits", suggestedAccountId: null };
  if (byDigits.length > 1) return none;

  const bank = bankKeyOf(msg.bankName, msg.sender);
  if (!bank) return none;
  const accounts = await Account.find({ user: userId, isArchived: { $ne: true } })
    .select("_id name type smsLastFour creditMeta.lastFourDigits")
    .lean<AccountRow[]>();
  const sameBank = accounts.filter((a) => NAME_ALIASES[bank].test(a.name.toUpperCase()));
  const sameKind = sameBank.filter((a) => kindMatches(a, msg.instrument));
  const usable = sameKind.filter((a) => !hasOtherDigits(a));

  if (usable.length === 1 && sameKind.length === 1) {
    return { accountId: usable[0]._id.toString(), matchedBy: "bank", suggestedAccountId: null };
  }
  const suggestion = usable[0] ?? sameKind[0] ?? sameBank[0];
  return { ...none, suggestedAccountId: suggestion ? suggestion._id.toString() : null };
}

/**
 * The user confirmed (or corrected) a captured transaction whose account
 * was found by bank name: save the message's digits on that account so
 * the next message matches by digits. Skipped when another account already
 * uses those digits.
 */
export async function learnDigitsFromCapture(
  userId: string,
  txn: { account?: Types.ObjectId | string | null; sourceCapture?: Types.ObjectId | string | null },
  { force = false }: { force?: boolean } = {}
) {
  try {
    if (!txn.account || !txn.sourceCapture) return;
    const capture = await CapturedMessage.findOne({ _id: txn.sourceCapture, user: userId })
      .select("parse.fields.last4 accountMatch")
      .lean<{ parse?: { fields?: { last4?: string } }; accountMatch?: string }>();
    const last4 = capture?.parse?.fields?.last4;
    if (!last4 || !/^\d{4}$/.test(last4)) return;
    if (!force && capture?.accountMatch !== "bank") return;

    const taken = await Account.exists({
      user: userId,
      _id: { $ne: txn.account },
      isArchived: { $ne: true },
      $or: [{ smsLastFour: last4 }, { "creditMeta.lastFourDigits": last4 }],
    });
    if (taken) return;
    // Accounts keep at most 10 match digits (see the accounts API).
    await Account.updateOne(
      { _id: txn.account, user: userId, "smsLastFour.9": { $exists: false } },
      { $addToSet: { smsLastFour: last4 } }
    );
  } catch (err) {
    logger.error({ err, userId }, "learning SMS match digits failed");
  }
}
