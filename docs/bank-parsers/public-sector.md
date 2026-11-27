# Bank parsers: public sector banks (ticket 171)

One section per parser: SMS headers and app packages it claims, the message shapes it reads (described in words,
never a real message), what it overrides, and anything left to the generic parser. Code: `src/lib/capture/parsers/banks/`;
tests: `src/test/capture-banks/public-sector/`. Every parser takes the account next to the verb first when a message
names two accounts, and never a loan or card account's mask.

All ten extend `PublicSectorParser` (`banks/public-sector-base.ts`), which keeps two reads in Review whatever shape
matched: a debit that was reversed, refunded or not dispensed (the verb only: a payee called "REFUND CORNER" or a help
line "Cash not dispensed? Call …" changes nothing), and a credit into a loan or towards an EMI as what was credited
("towards Loan EMI", "loan a/c … credited", "--LOAN RECOVERY"; a promo "Apply for a Home Loan" or a payer "EMI STORE"
does not count). That credit also drops its account digits, balance and a "Loan EMI" merchant, so a confirm can never
teach a savings account the loan's number. Its `nameOnly` cleans a payee: no "Sender:"/"Beneficiary:" label, no
"towards refund…"/"reversal of…"/bare "REV"/"…Loan disbursal" reason (real names such as "REV MOTORS", "Towards
Travels", "SENDER ENTERPRISES" stay), no run of eight or more digits, and no UPI id made of a phone number. When a
bank's own payee field matches but holds no name, the parser gives no merchant rather than the shared guess.

## Canara Bank (`canara.ts`)
- Headers `CANBNK`, `CANARA`. No app package.
- Shapes: "Dear Customer, Acct XXX… Dr./credited with INR …"; "An amount of INR … has been credited to XXXX…".
- Reads a three- or four-digit account after "Acct" (a three-digit last4 matches a saved account only by the bank
  guess); on a NEFT/RTGS credit, the account credited, never "Sender A/c"; the sender after "by Sender" or the payee
  after "to Beneficiary"; the UPI ref. Money "towards your Loan A/c from SB A/c …" takes the savings account, never the
  loan's (only for a loan account or repayment, never a payee called "… LOAN TRADERS").

## Punjab National Bank (`pnb.ts`)
- Headers `PNBSMS`, `PNBBNK`, `PNBCCD` (credit cards). No app package.
- Shapes: "Ac/A/c XX… Debited/Credited with Rs.…"; "A/c X… debited INR … Dt …"; "PNB Credit Card 1234 debited with
  Rs.…"; "Your a/c no XX… is debited for Rs …" (two accounts).
- Reads the card's plain digits, the payee before "thru UPI", the UPI ref; a debit "thru card … at <bank> ATM" or with
  the "free txn on PNB ATM" line is cash from an ATM, never a charge or fee at one ("at non-PNB ATM"), a shop ("at ATM
  STORES", "near … ATM") or a reversal; a charge line after the ATM sentence does not undo it. A help line ("report it to
  the bank") or an ATM is never the payee.

## Bank of Baroda (`bob.ts`)
- Headers `BOBSMS`, `BOBTXN`, `BOBCRD`. App `com.bankofbaroda.mconnect`.
- Shapes: "Rs.… Dr./Cr. from/to …"; "Rs.… transferred from A/c ...1234 to:NAME"; "Rs.… credited to A/c XX… via …";
  "spent on your BOBCARD ending 1234".
- "Dr."/"Cr." right after the message's first amount decides the direction ("Cr. to <UPI id>" is money in from that
  id); a "Cr"/"Dr" after a balance is only the balance's sign. A message naming a loan account goes to the shared rules.
  A dotted mask or a six-digit account ("XX123456") gives its last four; the payee after "to:"; no merchant on a cash
  deposit.
- BOBCARD is a credit card: paying it (from the account, "to:BOBCARD 3381", "towards BOBCARD", a payment received on
  it) is a card bill payment in Review with the card's own digits, read only in the sentence holding the amount and
  never on a spend or a refund; the card is never the payee, but a shop named "BOBCARD STATIONERS" is.

## Union Bank of India (`union.ts`)
- Header `UNIONB`. No app package.
- Shapes: "Union Bank of India A/c*1234 Dr/Cr Rs…"; "A/c *1234 Debited/Credited for Rs:…".
- Reads "Rs:" amounts and balances; the payee after "by MB <number>" without any phone number after it. That number
  may itself be a phone number, so it is never kept as the reference. "by Mob Bk" names no payee.

## Bank of India (`boi.ts`)
- Headers `BOIIND`, `BOIBNK`. No app package.
- Shapes: "Rs.… debited A/cXX1234 and credited to NAME via UPI …"; "BOI - (Cash) Rs … Credited/Debited/deposited …".
- "debited A/c … and credited to NAME" is money out with no doubt, unless it has been reversed or refunded; the payee after "credited to"; a NEFT sender after
  "NEFTINWARD <code>/"; a cash deposit machine is never the payer.

## Central Bank of India (`central.ts`)
- Header `CENTBK`. No app package.
- Shape: "Rs. … credited to/debited from your A/c xxxx1234 on <date> through …".
- The other party after "By." or "To." before the "-CBoI" sign-off, without a "REFUND" label or a "will be credited"
  promise; the ref after "Ref No.".

## Indian Bank (`indian.ts`)
- Header `INDBNK`. App `com.infrasofttech.indianbank`.
- Shapes: "Rs.… credited to a/c *1234 on …"; "Sent Rs.… from A/c *1234 on …"; "UTR:<code>/NEFT/".
- The payee before ".RRN", the NEFT sender between slashes, the RRN as the ref.

## Indian Overseas Bank (`iob.ts`)
- Header `IOBCHN`. No app package. No shape of its own: it names the bank and the shared rules read the message,
  with no bonus.

## UCO Bank (`uco.ts`)
- Header `UCOBNK`. No app package.
- Shape: "A/c XX1234 Debited/Credited with Rs.… on …". The channel ("UCO-UPI", "UCO-IMPS") is never the payee; a
  name after it is kept.

## Punjab & Sind Bank (`psb.ts`)
- Header `PSBANK`. No app package.
- Shape: "A/c No **1234 Credited/Debited with Rs …--".
- The other party and the ref from the rail path after "--" ("NEFT/<ref>/NAME (", "IMPS/<ref>/NAME/…",
  "UPI/CR/<ref>/NAME/…"), without a phone number or a "REV" code; a note after "--" ("Vendor Amount", "EMI") is never
  a name. A loan account ("Loan A/c No **…") is never the account.

## Left out on purpose
- Headers seen elsewhere but not sure enough to claim: `PUNBN` (PNB), `BARODA`/`BOB` (Bank of Baroda), `UBOI`
  (Union), `CBOI` and other Central Bank variants, IOB headers other than `IOBCHN`, three-letter `PNB`/`BOB`/`BOI`.
  Messages from them still reach the generic parser.
