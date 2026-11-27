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
// headers (the part after "VM-"). Order matters where one name sits inside another ("South Indian Bank" before
// "Indian Bank", "Central Bank of India" and "Union Bank of India" before "Bank of India"). Ticket 177 added the
// phase 9 banks.
const BANKS = [
  { key: "HDFC", name: /\bHDFC\b/, sender: /HDFC/ },
  { key: "ICICI", name: /\bICICI\b/, sender: /ICICI/ },
  { key: "SBI", name: /\bSBI\b|\bSTATE BANK\b/, sender: /SBI/ },
  { key: "AXIS", name: /\bAXIS\b/, sender: /AXIS/ },
  { key: "KOTAK", name: /\bKOTAK\b/, sender: /KOTAK/ },
  { key: "IDFC", name: /\bIDFC\b/, sender: /IDFC/ },
  { key: "YES", name: /\bYES ?BANK\b/, sender: /YESB/ },
  { key: "INDUSIND", name: /\bINDUS ?IND\b/, sender: /INDUS/ },
  { key: "PNB", name: /\bPNB\b|\bPUNJAB NATIONAL\b/, sender: /PNB/ },
  { key: "PSB", name: /\bPUNJAB ?(?:&|AND) ?SIND\b|\bP ?& ?S ?B\b/, sender: /^PSBANK/ },
  { key: "BARODA", name: /\bBOB\b|\bBARODA\b/, sender: /BOB|BARODA/ },
  { key: "CANARA", name: /\bCANARA\b/, sender: /CANBNK|CANARA/ },
  { key: "CENTRAL", name: /\bCENTRAL BANK\b|\bCBOI\b/, sender: /^CENTBK/ },
  { key: "UNION", name: /\bUNION BANK\b|\bUBI\b/, sender: /UBOI|UNION/ },
  { key: "BOI", name: /\bBOI\b|(?<!\b(?:CENTRAL|UNION) )\bBANK OF INDIA\b/, sender: /^BOI(?:IND|BNK)/ },
  { key: "IOB", name: /\bIOB\b|\bINDIAN OVERSEAS\b/, sender: /^IOB/ },
  { key: "SIB", name: /\bSOUTH INDIAN\b|\bSIB\b/, sender: /^SIBSMS/ },
  { key: "INDIAN", name: /(?<!\bSOUTH )\bINDIAN BANK\b/, sender: /^INDBNK/ },
  { key: "UCO", name: /\bUCO\b/, sender: /^UCOBNK/ },
  { key: "FEDERAL", name: /\bFEDERAL\b|\bFI MONEY\b/, sender: /FEDBNK|FEDFIB|FEDERAL/ },
  { key: "IDBI", name: /\bIDBI\b/, sender: /^IDBIBK/ },
  { key: "KARNATAKA", name: /\bKARNATAKA BANK\b|\bKBL\b/, sender: /^KBLBNK/ },
  { key: "CUB", name: /\bCITY UNION\b|\bCUB\b/, sender: /^CUBANK/ },
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
  { key: "JUPITER", name: /\bJUPITER\b|\bCSB\b/, sender: /^JTEDGE/ },
  { key: "SLICE", name: /\bSLICE\b/, sender: /^SLC(?:EIT|BNK)/ },
  { key: "ONECARD", name: /\bONE ?CARD\b/, sender: /^ONECRD/ },
  { key: "RBL", name: /\bRBL\b/, sender: /RBL/ },
] as const;

type BankKey = (typeof BANKS)[number]["key"];

// How each bank appears in account names people type.
const NAME_ALIASES = Object.fromEntries(BANKS.map((b) => [b.key, b.name])) as Record<BankKey, RegExp>;

// Parsed bank name ("HDFC Bank", "Bank of Baroda", "IDFC FIRST", "South Indian Bank") to key: the first bank, in the
// order above, whose name pattern matches.
function keyFromBankName(bankName?: string): BankKey | undefined {
  if (!bankName) return undefined;
  const n = bankName.toUpperCase();
  return BANKS.find((b) => b.name.test(n))?.key;
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

  // A bank that masks to three digits (ICICI "XX274", Canara, Jana, HSBC "***-731"): the saved four digits that end
  // with them, only when exactly one of the user's accounts has such digits, and that account is not named after a
  // different bank. Three digits are never learned (learnDigitsFromCapture keeps four). Ticket 177.
  if (/^\d{3}$/.test(msg.last4)) {
    const tail = new RegExp(`\\d${msg.last4}$`);
    const bySuffix = await Account.find({
      user: userId,
      isArchived: { $ne: true },
      $or: [{ smsLastFour: tail }, { "creditMeta.lastFourDigits": tail }],
    })
      .select("_id name")
      .limit(2)
      .lean<{ _id: Types.ObjectId; name: string }[]>();
    if (bySuffix.length > 1) return none;
    if (bySuffix.length === 1) {
      const name = bySuffix[0].name.toUpperCase();
      const otherBank = bank && !NAME_ALIASES[bank].test(name) && BANKS.some((b) => b.key !== bank && b.name.test(name));
      if (!otherBank) return { accountId: bySuffix[0]._id.toString(), matchedBy: "digits", suggestedAccountId: null };
      return none;
    }
  }

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
