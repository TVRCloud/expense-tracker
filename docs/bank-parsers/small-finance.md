# Bank parsers: small finance and payments banks (ticket 173)

One section per parser: SMS headers it claims, the message shapes it reads (described in words, never a real
message), what it overrides, and anything left to the generic parser. No app packages are claimed: none of these
banks' apps is on the phone's known list, so only SMS routes here. Shared readers for this group are in
`src/lib/capture/parsers/banks/small-finance-helpers.ts` (`upiPath`, which keeps a reference's digits only and drops a leading D or C; `cleanVpa`, which drops a label glued after a UPI id, "swiggy@ybl.Avl"; `maskOrNumber`, which rejects a payee that is a mask, a number or an account) and `SmallFinanceParser`, the base
every parser here extends: a debit or credit whose own sentence (`moneySentence`, never a help or promo line) also says
refund, refunded, reversed or reversal is never auto-booked either way; it waits in Review. Tests:
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
- Overrides: the account, written with plain last four digits after the bank's name (the shared reader needs a mask),
  taken only beside the verb that matches the direction ("debited (via UPI) from Equitas-1234 / Equitas A/c 1234",
  "credited (via UPI) to Equitas A/c 1234", "Equitas A/c 1234 is credited"), never after "by debit to". The payee is
  read only after "-Ref:<ref> [on <date>] to" (a payer after "from"): the shared reader took "Equitas-4419" or the help
  line's number. A deposit, RD or loan credited by a debit from the account ("credited to … RD A/c … by debit to
  Equitas A/c …") is a move between the person's own accounts: always Review. A message without the bank's own wording
  falls back to the shared readers. "via UPI/IMPS/NEFT/RTGS" may sit before "from"/"to". Two different Equitas accounts in
  one message is a move between the person's own accounts: Review. A shared-shape loan EMI ("loan a/c … credited … by
  debit to A/c XX…") is not capped (the shared loan rule books it as an expense). A payee loses a trailing "is
  reversed" / "has failed".

## Utkarsh Small Finance Bank SuperCard (`utkarsh`, `utkarsh.ts`)
- Headers: `UTKSPR`, `UTKSFB`.
- Shapes: "Rs. … spent on your Utkarsh SuperCard XX1234 for UPI - <UPI id> on <date>" or "… for <shop> on <date>".
- Overrides: the card's last four, taken only in the spend shape "spent on your Utkarsh SuperCard XX1234"; the payee
  after "for UPI -" or "for"; also "debited on your Utkarsh SuperCard XX1234" (an EMI on the card). A UPI id containing
  "supercard" is a payee, not the card. Money paid to the card ("paid to your Utkarsh SuperCard", "for … SuperCard XX1234
  repayment", "towards … SuperCard … bill payment") is a card bill payment: Review, with the card's own digits.

## Jana Small Finance Bank (`jana`, `jana.ts`)
- Headers: `JANABK`.
- Shapes: "Your acct XX123 is debited with INR … to <UPI id>" / "is credited with INR … from <name>".
- Overrides: the account, masked to three digits, taken only next to the verb that matches the direction.
- Known gap: three digits never match a saved four-digit account today, so these alerts are matched by the bank guess
  only (the same as ICICI); account matching by suffix is a separate fix.

## Suryoday Small Finance Bank credit card (`suryoday`, `suryoday.ts`)
- Headers: `SSFBNK`.
- Shapes: "Rs … spent on [<card name>] Suryoday SFB CC 1234 on <date> at <time>. Avlb Rs …".
- Overrides: the card's last four, taken only in the spend shape ("spent on … Suryoday SFB CC 1234" or "spent at <shop>
  using Suryoday SFB CC 1234", whose shop is the merchant), decided on the money sentence only so a promo line naming
  the card changes nothing; the available limit after "Avlb"; no merchant (no
  shop is printed; the "to 9000…" in the help line is a phone number). The "Avlb Rs …" figure is removed before the
  amount is read, so a spend abroad ("USD 12.40 spent on …") reads its own amount and stays in Review. Money paid to
  the card ("paid towards / credited to / payment of / towards … Suryoday SFB CC 1234") is a card bill payment: Review,
  with the card's own digits.

## Airtel Payments Bank (`airtel_pb`, `airtel-pb.ts`)
- Headers: `AIRBNK`.
- Shapes: "Airtel Payments Bank a/c is credited with Rs. …", "Rs. … debited from Airtel Payments Bank a/c Txn ID …".
- Overrides: the account. Only masked digits printed as its own account ("Airtel Payments Bank a/c XX1234") count, in
  any message from its header; never another party's ("to RAVI KUMAR A/c XX9911", "debited from your a/c XX9911"),
  never a bare number ("a/c 2026"). So, unlike the rest of the group, a message in another bank's wording keeps no
  account and goes to Review. Its usual alerts print no account digits, so a
  read goes to Review for the person to pick the account.
  Its balance ("Bal:212.40") has no currency, so it is not read.

## India Post Payments Bank (`ippb`, `ippb.ts`)
- Headers: `IPBMSG`.
- Shapes: "A/C X1234 Debit Rs. … for UPI to <UPI id>", "You have received a payment of Rs. … in a/c X1234 … from <name>
  thru IPPB. Info: UPI/CREDIT/<ref>".
- Overrides: direction ("Debit" or "Credit" before the amount; "received a payment", which the shared rule reads as
  both a debit and a credit word); a "Debit" whose own sentence says reversed is an unsure read and waits in Review, a
  help line about refunds does not count; the payer before "thru IPPB", the reference after "Info: UPI/CREDIT/".

## Jio Payments Bank (`jio_pb`, `jio-pb.ts`)
- Headers: `JIOPBS`.
- Shapes: "Your JPB A/c x1234 is debited with / credited with Rs. … UPI/DR/<ref>/<payee>.", "Rs. … Sent from x1234 to
  <UPI id>".
- Overrides: the account masked with a single "x" (after "JPB A/c" or "Sent from"), merchant and reference from the
  UPI path. A payee written as a mask ("to x4471", "to A/c x4471", "UPI/DR/<ref>/X4471") or a phone number is no
  merchant (the same check applies to AU's and Bandhan's UPI paths).

## NSDL Payments Bank (`nsdl_pb`, `nsdl-pb.ts`)
- Headers: `NSDLPB`.
- Shapes: "A/c XX1234 debited Rs … for linked <UPI id>", "… for linked <bank> PPI A/c XX9999 to <UPI id>", "A/c no
  XX1234 is credited for Rs. …".
- Overrides: the payee is the UPI id after "linked" or after "to", never the linked wallet's account.
