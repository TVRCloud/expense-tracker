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

// One entry per bank: how it appears in the parsed bank name and in the account names people type, and its SMS
// headers (the part after "VM-"). Where one bank's name sits inside another's ("State Bank of India" holds "Bank of
// India", "City Union Bank" holds "Union Bank", "South Indian Bank" holds "Indian Bank"), only the longer match counts
// (`banksInName`). Ticket 177 added the phase 9 banks.
const BANKS = [
  { key: "HDFC", name: /\bHDFC\b/, sender: /HDFC/ },
  { key: "ICICI", name: /\bICICI\b/, sender: /ICICI/ },
  { key: "SBI", name: /\bSBI\b|\bSTATE BANK(?: OF INDIA)?\b/, sender: /SBI/ },
  { key: "AXIS", name: /\bAXIS\b/, sender: /AXIS/ },
  { key: "KOTAK", name: /\bKOTAK\b/, sender: /KOTAK/ },
  { key: "IDFC", name: /\bIDFC\b/, sender: /IDFC/ },
  { key: "YES", name: /\bYES ?BANK\b/, sender: /YESB/ },
  { key: "INDUSIND", name: /\bINDUS ?IND\b/, sender: /INDUS/ },
  { key: "PNB", name: /\bPNB\b|\bPUNJAB NATIONAL\b/, sender: /PNB/ },
  { key: "PSB", name: /\bPUNJAB ?(?:&|AND) ?SIND\b|\bP ?& ?S ?B\b/, sender: /^PSBANK/ },
  { key: "BARODA", name: /\bBOB\b|\bBARODA\b(?!\s+(?:U\.?P\.?\s+|UTTAR\s+PRADESH\s+|RAJASTHAN\s+|GUJARAT\s+)?GRAMIN)/, sender: /BOB|BARODA/ },
  { key: "CANARA", name: /\bCANARA\b/, sender: /CANBNK|CANARA/ },
  { key: "CENTRAL", name: /\bCENTRAL BANK(?: OF INDIA)?\b|\bCBOI\b/, sender: /^CENTBK/ },
  { key: "UNION", name: /\bUNION BANK(?: OF INDIA)?\b|\bUBI\b/, sender: /UBOI|UNION/ },
  { key: "BOI", name: /\bBOI\b|\bBANK OF INDIA\b/, sender: /^BOI(?:IND|BNK)/ },
  { key: "IOB", name: /\bIOB\b|\bINDIAN OVERSEAS\b/, sender: /^IOB/ },
  { key: "SIB", name: /\bSOUTH[\s-]?INDIAN(?: BANK)?\b|\bSIB\b/, sender: /^SIBSMS/ },
  { key: "INDIAN", name: /\bINDIAN BANK\b/, sender: /^INDBNK/ },
  { key: "UCO", name: /\bUCO\b/, sender: /^UCOBNK/ },
  { key: "FEDERAL", name: /\bFEDERAL\b|\bFI MONEY\b/, sender: /FEDBNK|FEDFIB|FEDERAL/ },
  { key: "IDBI", name: /\bIDBI\b/, sender: /^IDBIBK/ },
  { key: "KARNATAKA", name: /\bKARNATAKA BANK\b|\bKBL\b/, sender: /^KBLBNK/ },
  { key: "CUB", name: /\bCITY UNION(?: BANK)?\b|\bCUB\b/, sender: /^CUBANK/ },
  { key: "TMB", name: /\bTAMILNAD MERCANTILE\b|\bTMB\b/, sender: /^TMBANK/ },
  { key: "DHANLAXMI", name: /\bDHANLAXMI\b|\bDHANLAKSHMI\b/, sender: /^DHANBK/ },
  { key: "JK", name: /\bJ ?& ?K\b|\bJAMMU (?:&|AND) KASHMIR\b|\bJKB\b/, sender: /^JKBANK/ },
  { key: "KERALA", name: /\bKERALA BANK\b|\bKSCB\b/, sender: /^KELBNK/ },
  { key: "KERALA_GRAMIN", name: /\bKERALA GRAMIN\b|\bKGB\b/, sender: /^KGBANK/ },
  { key: "SARASWAT", name: /\bSARASWAT\b/, sender: /^SARBNK/ },
  { key: "AU", name: /\bAU\b/, sender: /AUBANK|AUSFB/ },
  { key: "BANDHAN", name: /\bBANDHAN\b/, sender: /^(?:BDNSMS|BANDHN)/ },
  { key: "EQUITAS", name: /\bEQUITAS\b/, sender: /^(?:EQUTAS|EQUITA)/ },
  { key: "UTKARSH", name: /\bUTKARSH\b/, sender: /^UTKS(?:PR|FB)/ },
  { key: "JANA", name: /\bJANA\b/, sender: /^JANABK/ },
  { key: "SURYODAY", name: /\bSURYODAY\b/, sender: /^SSFBNK/ },
  { key: "AIRTEL", name: /\bAIRTEL\b/, sender: /^AIRBNK/ },
  { key: "IPPB", name: /\bIPPB\b|\bINDIA POST\b/, sender: /^IPBMSG/ },
  { key: "JIO", name: /\bJIO\b/, sender: /^JIOPBS/ },
  { key: "NSDL", name: /\bNSDL\b/, sender: /^NSDLPB/ },
  { key: "HSBC", name: /\bHSBC\b/, sender: /^HSBCIN/ },
  { key: "SC", name: /\bSTANDARD CHARTERED\b|\bSCB\b|\bSC BANK\b/, sender: /^SCBANK/ },
  { key: "DBS", name: /\bDBS\b|\bDIGIBANK\b/, sender: /^DBSBNK/ },
  { key: "AMEX", name: /\bAMEX\b|\bAMERICAN EXPRESS\b/, sender: /^AMEXIN/ },
  { key: "JUPITER", name: /\bJUPITER\b/, sender: /^JTEDGE/ },
  { key: "SLICE", name: /\bSLICE\b/, sender: /^SLC(?:EIT|BNK)/ },
  { key: "ONECARD", name: /\bONE ?CARD\b/, sender: /^ONECRD/ },
  { key: "RBL", name: /\bRBL\b/, sender: /RBL/ },
] as const;

type BankKey = (typeof BANKS)[number]["key"];

/** The banks a name (an account's or a parsed bank name) belongs to, longest match first. A match inside a longer
 * bank's match ("BANK OF INDIA" inside "STATE BANK OF INDIA") does not count. */
function banksInName(raw: string): BankKey[] {
  const name = raw.toUpperCase();
  const hits = BANKS.flatMap((b) => {
    const m = b.name.exec(name);
    return m ? [{ key: b.key as BankKey, start: m.index, end: m.index + m[0].length }] : [];
  });
  return hits
    .filter((h) => !hits.some((o) => o !== h && o.end - o.start > h.end - h.start && o.start <= h.start && o.end >= h.end))
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .map((h) => h.key);
}

const namedFor = (name: string, bank: BankKey) => banksInName(name).includes(bank);

// Parsed bank name ("HDFC Bank", "Bank of Baroda", "IDFC FIRST", "South Indian Bank") to key: the longest bank name in it.
function keyFromBankName(bankName?: string): BankKey | undefined {
  return bankName ? banksInName(bankName)[0] : undefined;
}

// DLT sender IDs look like "VM-HDFCBK", "AD-ICICIB", "JD-SBIINB".
function keyFromSender(sender?: string): BankKey | undefined {
  if (!sender) return undefined;
  const code = sender.toUpperCase().replace(/^[A-Z]{2}-/, "");
  return BANKS.find((b) => b.sender.test(code))?.key;
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
  const sameBank = accounts.filter((a) => namedFor(a.name, bank));
  const sameKind = sameBank.filter((a) => kindMatches(a, msg.instrument));
  const usable = sameKind.filter((a) => !hasOtherDigits(a));

  // A bank that masks to three digits (ICICI "XX274", Canara, Jana, HSBC "***-731"): saved four digits that end with
  // them. Only with a known bank, only accounts of the right kind, and an account named after this bank wins; one named
  // after no bank counts only when the user has no account named after this bank; one named after another bank never.
  // Exactly one such account, or nothing. Three digits are never learned (learnDigitsFromCapture keeps four). Ticket 177.
  if (/^\d{3}$/.test(msg.last4)) {
    const endsWith = (d?: string) => typeof d === "string" && d.length === 4 && d.endsWith(msg.last4!);
    const bySuffix = accounts.filter(
      (a) => kindMatches(a, msg.instrument) && ((a.smsLastFour ?? []).some(endsWith) || endsWith(a.creditMeta?.lastFourDigits))
    );
    const ofBank = bySuffix.filter((a) => namedFor(a.name, bank));
    const unnamed = sameBank.length === 0 ? bySuffix.filter((a) => banksInName(a.name).length === 0) : [];
    const pick = ofBank.length > 0 ? ofBank : unnamed;
    if (pick.length === 1) return { accountId: pick[0]._id.toString(), matchedBy: "digits", suggestedAccountId: null };
    if (pick.length > 1) return none;
  }

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
