# Bank parsers: small finance and payments banks (ticket 173)

One section per parser: SMS headers it claims, the message shapes it reads (described in words, never a real
message), what it overrides, and anything left to the generic parser. No app packages are claimed: none of these
banks' apps is on the phone's known list, so only SMS routes here. Shared readers for this group are in
`src/lib/capture/parsers/banks/small-finance-helpers.ts` (`upiPath`, `plainAccount`). Tests:
`src/test/capture-banks/small-finance/`.

## AU Small Finance Bank (`au`, `au.ts`)
- Headers: `AUBANK`.
- Shapes: "Debited INR … from A/c X1234 on <date>", "Dr INR … - AU A/c X1234 <date>", "Cr INR … to A/c X1234 <date>",
  each with a UPI path on its own line ("UPI/DR/<ref>/<payee>/<bank>/…"); a credit card spend "INR … spent at <shop> on
  AU Bank Credit Card x1234".
- Overrides: merchant and reference from the UPI path. A path that names a bank account gives no merchant, so the help
  line's number ("SMS BLOCK UPI to 56…") is never taken.

## Bandhan Bank (`bandhan`, `bandhan.ts`)
- Headers: `BDNSMS`, `BANDHN`.
- Shapes: "INR … debited from A/c XXXXXXXXXX1234 towards UPI/DR/D<ref>/<payee> Value <date>", "INR … deposited to A/c …
  towards UPI/CR/C<ref>/<payer>/u on <date>", "your account XXXX1234 is credited with INR … towards interest".
- Overrides: merchant and reference (with its D/C letter) from the UPI path. "Clear Bal is INR …" is read by the shared
  balance reader.

## Equitas Small Finance Bank (`equitas`, `equitas.ts`)
- Headers: `EQUTAS`, `EQUITA`. Not `EQUITS`: that header belongs to Equity Bank (Kenya).
- Shapes: "INR … debited via UPI from Equitas A/c 1234 -Ref:<ref> … to <payee>", "… credited via UPI to Equitas A/c 1234
  … from <payer>", "INR … debited from Equitas-1234 via UPI …".
- Overrides: the account, written with plain last four digits after the bank's name (the shared reader needs a mask).

## Utkarsh Small Finance Bank SuperCard (`utkarsh`, `utkarsh.ts`)
- Headers: `UTKSPR`, `UTKSFB`.
- Shapes: "Rs. … spent on your Utkarsh SuperCard XX1234 for UPI - <UPI id> on <date>" or "… for <shop> on <date>".
- Overrides: the card's last four after "SuperCard" (a card), the payee after "for UPI -" or "for".

## Jana Small Finance Bank (`jana`, `jana.ts`)
- Headers: `JANABK`.
- Shapes: "Your acct XX123 is debited with INR … to <UPI id>" / "is credited with INR … from <name>".
- Overrides: the account, masked to three digits, taken only next to the verb that matches the direction. Three digits
  never match a saved four-digit account, so account matching falls back to the bank guess (same as ICICI).

## Suryoday Small Finance Bank credit card (`suryoday`, `suryoday.ts`)
- Headers: `SSFBNK`.
- Shapes: "Rs … spent on [<card name>] Suryoday SFB CC 1234 on <date> at <time>. Avlb Rs …".
- Overrides: the card's last four after "CC", the available limit after "Avlb", and no merchant (no shop is printed;
  the "to 9000…" in the help line is a phone number).

## Airtel Payments Bank (`airtel_pb`, `airtel-pb.ts`)
- Headers: `AIRBNK`.
- Shapes: "Airtel Payments Bank a/c is credited with Rs. …", "Rs. … debited from Airtel Payments Bank a/c Txn ID …".
- No overrides. Its alerts print no account digits, so a read always goes to Review for the person to pick the account.
  Its balance ("Bal:212.40") has no currency, so it is not read.

## India Post Payments Bank (`ippb`, `ippb.ts`)
- Headers: `IPBMSG`.
- Shapes: "A/C X1234 Debit Rs. … for UPI to <UPI id>", "You have received a payment of Rs. … in a/c X1234 … from <name>
  thru IPPB. Info: UPI/CREDIT/<ref>".
- Overrides: direction ("Debit" before the amount; "received a payment", which the shared rule reads as both a debit
  and a credit word), the payer before "thru IPPB", the reference after "Info: UPI/CREDIT/".

## Jio Payments Bank (`jio_pb`, `jio-pb.ts`)
- Headers: `JIOPBS`.
- Shapes: "Your JPB A/c x1234 is debited with / credited with Rs. … UPI/DR/<ref>/<payee>.", "Rs. … Sent from x1234 to
  <UPI id>".
- Overrides: the account masked with a single "x" (after "JPB A/c" or "Sent from"), merchant and reference from the
  UPI path.

## NSDL Payments Bank (`nsdl_pb`, `nsdl-pb.ts`)
- Headers: `NSDLPB`.
- Shapes: "A/c XX1234 debited Rs … for linked <UPI id>", "… for linked <bank> PPI A/c XX9999 to <UPI id>", "A/c no
  XX1234 is credited for Rs. …".
- Overrides: the payee is the UPI id after "linked" or after "to", never the linked wallet's account.
