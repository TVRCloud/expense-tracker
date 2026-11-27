# Bank parsers: other private banks (ticket 172)

One section per parser: SMS headers and app packages it claims, the message shapes it reads (described in words,
never a real message), what it overrides, and anything left to the generic parser. Code in
`src/lib/capture/parsers/banks/<file>.ts`, listed in `banks/groups/private.ts`; tests in
`src/test/capture-banks/private/`. No app packages are claimed: the phone's bank app list has none of these banks yet.

Shared by the group (`banks/private-base.ts`, `banks/party-scrub.ts`):
- A debit with an undo word anywhere in the message ("reversed", "reversal", "refunded", "returned unpaid", "bounced",
  "charged back") stays in Review, a payee's own name included ("REVERSAL CAFE" goes to Review too: accepted noise).
- Payee names lose references, masked numbers and card numbers ("631088123456/name@bank" keeps the UPI id, "HDFC CC
  6612" becomes "HDFC CC"); a one-X code ("X7781") is removed only after a/c, account or card, when it is the whole
  name, or (South Indian, whose accounts use one X) at the end of a name ("RAVI X7781" becomes "RAVI"); digits inside a UPI id and names like "X1000 FITNESS" or "9x12 FURNITURE" are kept.
- A card the message only mentions ("towards ... Debit Card 6612 annual fee") never replaces the account the money
  left or reached (Federal, YES BANK, IndusInd); that account must be written with its number ("debited from account
  linked to the card" names none, so the card stays).

## Federal Bank (`federal.ts`, id `federal`)
- Headers: `FEDBNK`, `FEDFIB`. Left out: `FEDSCP` (a co-branded card; not sure it only carries Federal's messages).
- Shapes: "Debited Rs X from a/c X1234 on <date> <time> via UPI to <UPI id>", "Rs X debited/credited via UPI|IMPS|NEFT
  on ...", "Rs X credited to your A/c XX1234 via IMPS", "<name>, you've received INR X in your Account XXXX1234 ... It
  was sent by NAME on <Month> <day>, <year>", and an e-mandate card payment "payment of INR X for NAME via e-mandate ...
  on Federal Bank Debit Card 1234 is processed".
- Overrides: the card digits of "Federal Bank Debit|Credit Card 1234"; the payee after "for" in an e-mandate payment
  and after "It was sent by".

## IDBI Bank (`idbi.ts`, id `idbi`)
- Header: `IDBIBK` (never the IDFC headers).
- Shapes: "IDBI Bank Acct XX1234 debited for Rs X on <date>; Bal Rs Y NAME credited. UPI:<ref>", "Acct XX1234 is
  credited with Rs X on <date> from NAME".
- Overrides: the payee between the balance figure and "credited" (the shared rule would take a help-line word); the
  `UPI:<12 digits>` reference; "towards NAME for AutoPay".

## YES BANK (`yes.ts`, id `yes`)
- Header: `YESBNK`.
- Shape: "INR X spent on YES BANK Card X1234 @UPI_<shop> <date> <time>. Avl Lmt INR Y".
- Overrides: the card digits; the shop after "@" (and "UPI_") up to the date.

## IndusInd Bank (`indusind.ts`, id `indusind`)
- Header: `INDUSB`.
- Shapes: "A/c *XX1234 debited|credited by Rs X towards|from <UPI id>", "INR X spent on IndusInd Card XX1234 on ...
  at SHOP", "INR X debited from your A/C 201***041234 towards Debit Card Purchase".
- Accounts: every account number outside promo sentences ("Pay bills from your A/C ...", "Now pay ...", "Get ...")
  is counted, star-masked ("A/c *XX1234") or partly shown ("A/C 201***041234", "Account 15XXXXX1234"); loan, card,
  deposit, RD and FD accounts are not counted, nor is the other party's account: one labelled Beneficiary, Benef,
  Payee or Remitter, or one after a bare "to"/"from" ("sent to A/C ...", "received from A/C ...") that is not the
  person's own account moving ("debited from A/C", "by debit to A/C", "credited to your A/C"; "from A/C" into the
  person's own loan or deposit is their savings). Only the other party's account named: no account. One account: it is the account. Two or more: no guessing, whatever
  "your", "from" or "to" says: no account, no balance or limit, and Review (a refund naming the same account twice is
  held too).
- Overrides: the UPI id after "towards"; the card digits when no account with a number is named; the payee after the
  last "/" of an ACH debit; deposit interest "paid on your ... Deposit" is money in (income, no account, so Review),
  but TDS deducted on it is not; money moved into an RD, FD or deposit (also spelled out) from the one savings account
  the message names is an expense of it, and so is a loan account credited from it (a repayment); "debited from your account linked for IndusInd Credit Card XX1234 payment" is
  a card bill payment; a payee built around a masked number, one that runs into "debited"/"credited", and the "-
  IndusInd Bank" sign-off are dropped; promo sentences never add a verb.

## South Indian Bank (`south-indian.ts`, id `south_indian`)
- Header: `SIBSMS`.
- Shapes: "UPI debit:Rs.X A/c X1234, <date> RRN: <ref>", "A/c X1234 DEBIT:Rs.X SHOP MCT Bal:Rs.Y", "UPI
  Credit:INR Rs.X in A/c X1234. Info: UPI/<bank>/<ref>/ NAME on <date>", "Your A/c X1234 is credited with Rs.X Info:
  IMPS/<bank>/<ref>/ NAME".
- Overrides: direction from "debit:" / "credit:" before an amount, read only before "Info:"/"Remarks:"/"Note:" (any
  spelling) and deciding over any word in the Info text; a token that leads the message wins over a later one
  ("UPI Credit:... Info: ... Paid via ..." is income), but only when the token leads the message or the message is
  one of the shapes ("Last debit:Rs.X", "Hold debit:Rs.X", a returned cheque are not a transaction) and never next to
  reversed/returned/failed (then Review); "CC PAYMENT" right after the amount (optionally after a short bank word) or right after
  the RRN is a card bill payment, never inside a shop name ("ABC CC PAYMENT SOLUTIONS"); the shop before "MCT"/"Bal:"; the
  payer in the Info field; the reference in the Info field.

## Karnataka Bank (`karnataka.ts`, id `karnataka`)
- Header: `KBLBNK`. Not `KBANKT`: no evidence it is Karnataka Bank's (it appears in Kotak's own links), so it is
  claimed by nobody.
- Shape: "Your a/c XX1234 debited for Rs.X on <date> trf to NAME. UPI:<masked ref>". The shared rules read it.

## City Union Bank (`city-union.ts`, id `city_union`)
- Header: `CUBANK`. Left out: `CUBLTD` (not sure).
- Shape: two accounts in one message ("Your a/c no. XXXX1234 is debited for Rs.X ... and credited to a/c no.
  XXXX5678 (UPI Ref no <ref>)").
- Overrides: the account next to the verb that matches the direction (`verbAccount`).

## Tamilnad Mercantile Bank (`tamilnad-mercantile.ts`, id `tmb`)
- Header: `TMBANK`.
- Shape: "Your A/c No.XXXX1234 is debited with Rs.X on <date> <time> and <bank> A/c linked to <UPI id> is credited
  (UPI Ref No.<ref>)".
- Overrides: `verbAccount`; the UPI id after "linked to"; the "UPI Ref No." reference.

## Dhanlaxmi Bank (`dhanlaxmi.ts`, id `dhanlaxmi`)
- Header: `DHANBK`.
- Shapes: "INR X is debited from|credited to A/c XXXX1234 on <date> - "UPI TXN: /<ref>-<note>/..."", and the
  two-account "is credited for Rs.X ... and debited from a/c no. ...".
- Overrides: `verbAccount`; the reference after "UPI TXN: /"; for an expense the UPI id between slashes, for income the
  payer after "Payment from" (never an app name like PhonePe).

## J&K Bank (`jk.ts`, id `jk`)
- Header: `JKBANK`.
- Shape: "Your A/c XXXX1234 is Debited by|Credited with INR X ... by RTGS-<ref>. A/C Bal is INR Y Cr".
- Overrides: the reference after "RTGS-", "NEFT-" or "IMPS-".

## Kerala Bank (`kerala.ts`, id `kerala`)
- Header: `KELBNK`.
- Shape: "Dear Customer Your A/c no XXXX1234 is credited|debited with X on <date> by NEFT|UPI From|To : NAME. Balance
  is Y" (no currency on the amount; the shared bare-amount rule reads it).
- Overrides: the party after "From :" (income) or "To :" (expense). A "Loan Recovery" credit or a negative balance
  is a loan account, not the person's money moving: a credit like that is kept in Review (a debit is not).

## Kerala Gramin Bank (`kerala-gramin.ts`, id `kerala_gramin`)
- Header: `KGBANK`.
- Shapes: the two-account UPI debit ("is debited for Rs.X ... and credited to a/c no. ..."), "Account XXXX1234 is
  credited with INR X on <date> from <UPI id>".
- Overrides: `verbAccount`.

## Saraswat Bank (`saraswat.ts`, id `saraswat`)
- Header: `SARBNK`.
- Shapes: "Your A/c no. 1234 is credited with INR X on <date> towards ACH Credit:NAME", "Your account no. ending with
  1234 is debited with INR X on <date> for IMPS|NEFT|RTGS|S.I.".
- Overrides: the payer after "ACH Credit:" / "ACH Debit:". "Current Bal" is not read as a balance (ticket 156 rule).
