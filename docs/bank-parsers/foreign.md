# Bank parsers: foreign banks in India

One section per parser: SMS headers and app packages it claims, the message shapes it reads (described in words,
never a real message), what it overrides, and anything left to the generic parser. Ticket 174. Indian accounts and
cards only; a spend in another currency stays in Review (capped at 0.6). No app packages are claimed: none of these
banks' apps is on the phone's known list.

## HSBC (`hsbc.ts`, header `HSBCIN`)
- Shapes: "HSBC: A/c <ddd-ddd***-ddd> is credited|debited with INR ...", "HSBC: INR ... is credited to | paid from
  your A/c ...", "HSBC: INR ... is paid from account XXXXXX<4> to <payee> ...", "Thank you for using HSBC Debit|Credit
  Card ...", "Your HSBC creditcard xxxxx<4> used at <shop> for INR ...".
- Account: printed as "A/c 118-402***-731", so only three digits show (like ICICI); they are kept as last4. A NEFT
  credit also names the payer's account at their own bank ("as NEFT from UTIB A/c ***2271 of NAME"): never last4.
- An outgoing NEFT reads "your NEFT transaction ... has been credited to the <bank> A/c XX<4> of NAME": it is an
  expense, the beneficiary's account is never last4, and with no account of the person's printed it goes to Review.
- A debit card is masked to two digits ("XXXXX58xx"), too few to name an account: no last4.
- Merchant: the payer after "of" on a NEFT credit, the beneficiary on an outgoing NEFT, the shop after "used at" or
  "at", the payee after "paid from ... to".

## Standard Chartered (`standard-chartered.ts`, header `SCBANK`)
- Shapes: "Your a/c XX<4> is debited for Rs. ... and credited to a/c XX<4> (UPI Ref no ...)", "Dear Customer, there
  is an NEFT|RTGS|IMPS|UPI credit|debit of INR ... in|from your account <ddd>xxxx<4> ...".
- Direction: a transfer written as a noun ("an NEFT credit of", "an IMPS debit of"), which the shared rule does not read.
- Account: "your account 412xxxx5832" (first digits, mask, last four); on a UPI debit the account next to "debited"
  (the payee's masked account after "credited to" is never last4). The payee has no name, so no merchant.
- Balance: "Available Balance:INR ..." through the shared reader.

## DBS Bank (`dbs.ts`, header `DBSBNK`)
- Shape: "Your account no ********<4> is debited|credited with INR ...". The shared rules read it; the parser adds the
  bank's name and the bonus for the shape.
- "Current Balance is INR ..." is left unread: the shared balance rule skips "current" balances, which on a card mean
  the amount owed.

## American Express (`amex.ts`, header `AMEXIN`)
- Shapes: "You've spent INR ... on your AMEX card ** <5 digits> at <shop> on <date>", "received a payment of INR ...
  towards your AMEX card ** <5 digits>".
- The card prints five digits; the last four are kept, the length every other card uses for matching.
- A payment towards the card is a card bill payment (shared rule: capped at 0.5, Review).

## Left out
- Citi: its Indian retail and card business moved to Axis Bank in 2023, and no Indian Citi SMS header could be
  confirmed, so it has no parser; Citi-branded alerts now come from Axis and use the Axis parser.
- Other headers seen for these banks abroad (Standard Chartered in Pakistan, Bangladesh, Nepal, Nigeria; HSBC in other
  countries) are not claimed.
