# Bank parsers: public sector banks (ticket 171)

One section per parser: SMS headers and app packages it claims, the message shapes it reads (described in words,
never a real message), what it overrides, and anything left to the generic parser. Code: `src/lib/capture/parsers/banks/`;
tests: `src/test/capture-banks/public-sector/`. Every parser takes the account next to the verb first when a message
names two accounts, and never a loan or card account's mask.

## Canara Bank (`canara.ts`)
- Headers `CANBNK`, `CANARA`. No app package.
- Shapes: "Dear Customer, Acct XXX… Dr./credited with INR …"; "An amount of INR … has been credited to XXXX…".
- Reads a three- or four-digit account after "Acct" (a three-digit last4 matches a saved account only by the bank
  guess); on a NEFT/RTGS credit, the account credited, never "Sender A/c"; the sender after "by Sender"; the UPI ref.

## Punjab National Bank (`pnb.ts`)
- Headers `PNBSMS`, `PNBBNK`, `PNBCCD` (credit cards). No app package.
- Shapes: "Ac/A/c XX… Debited/Credited with Rs.…"; "A/c X… debited INR … Dt …"; "PNB Credit Card 1234 debited with
  Rs.…"; "Your a/c no XX… is debited for Rs …" (two accounts).
- Reads the card's plain digits, the payee before "thru UPI", the UPI ref; a debit "thru card … PNB ATM" is cash from
  an ATM. A help line ("report it to the bank") is never the payee.

## Bank of Baroda (`bob.ts`)
- Headers `BOBSMS`, `BOBTXN`, `BOBCRD`. App `com.bankofbaroda.mconnect`.
- Shapes: "Rs.… Dr./Cr. from/to …"; "Rs.… transferred from A/c ...1234 to:NAME"; "Rs.… credited to A/c XX… via …";
  "spent on your BOBCARD ending 1234".
- "Dr."/"Cr." right after the amount decides the direction ("Cr. to <UPI id>" is money in from that id); a dotted mask
  or a six-digit account ("XX123456") gives its last four; the payee after "to:"; no merchant on a cash deposit.

## Union Bank of India (`union.ts`)
- Header `UNIONB`. No app package.
- Shapes: "Union Bank of India A/c*1234 Dr/Cr Rs…"; "A/c *1234 Debited/Credited for Rs:…".
- Reads "Rs:" amounts and balances; the payee after "by MB <number>". That number may be a phone number, so it is
  never kept as the reference. "by Mob Bk" names no payee.

## Bank of India (`boi.ts`)
- Headers `BOIIND`, `BOIBNK`. No app package.
- Shapes: "Rs.… debited A/cXX1234 and credited to NAME via UPI …"; "BOI - (Cash) Rs … Credited/Debited/deposited …".
- "debited A/c … and credited to NAME" is money out with no doubt; the payee after "credited to"; a NEFT sender after
  "NEFTINWARD <code>/"; a cash deposit machine is never the payer.

## Central Bank of India (`central.ts`)
- Header `CENTBK`. No app package.
- Shape: "Rs. … credited to/debited from your A/c xxxx1234 on <date> through …".
- The other party after "By." or "To." before the "-CBoI" sign-off; the ref after "Ref No.".

## Indian Bank (`indian.ts`)
- Header `INDBNK`. App `com.infrasofttech.indianbank`.
- Shapes: "Rs.… credited to a/c *1234 on …"; "Sent Rs.… from A/c *1234 on …"; "UTR:<code>/NEFT/".
- The payee before ".RRN", the NEFT sender between slashes, the RRN as the ref.

## Indian Overseas Bank (`iob.ts`)
- Header `IOBCHN`. No app package. No shape of its own: it names the bank and the shared rules read the message,
  with no bonus.

## UCO Bank (`uco.ts`)
- Header `UCOBNK`. No app package.
- Shape: "A/c XX1234 Debited/Credited with Rs.… on …". The channel ("UCO-UPI") is never the payee.

## Punjab & Sind Bank (`psb.ts`)
- Header `PSBANK`. No app package.
- Shape: "A/c No **1234 Credited/Debited with Rs …--".
- The other party and the ref from the rail path after "--" ("NEFT/<ref>/NAME (", "UPI/CR/<ref>/NAME/…"); a note
  after "--" ("Vendor Amount") is never a name.

## Left out on purpose
- Headers seen elsewhere but not sure enough to claim: `PUNBN` (PNB), `BARODA`/`BOB` (Bank of Baroda), `UBOI`
  (Union), `CBOI` and other Central Bank variants, IOB headers other than `IOBCHN`, three-letter `PNB`/`BOB`/`BOI`.
  Messages from them still reach the generic parser.
