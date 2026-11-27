# Bank parsers: foreign banks in India

One section per parser: SMS headers and app packages it claims, the message shapes it reads (described in words,
never a real message), what it overrides, and anything left to the generic parser. Ticket 174. Indian accounts and
cards only; a spend in another currency stays in Review (capped at 0.6). No app packages are claimed: none of these
banks' apps is on the phone's known list.

## HSBC (`hsbc.ts`, header `HSBCIN`)
- Shapes: "HSBC: A/c <ddd-ddd***-ddd> is credited|debited with INR ...", "HSBC: INR ... is credited to | paid from
  your A/c ...", "HSBC: INR ... is paid from account XXXXXX<4> to <payee> ...", "Thank you for using HSBC Debit|Credit
  Card ...", "Your HSBC creditcard xxxxx<4> used at <shop> for INR ...".
- Account: printed as "A/c 118-402***-731", so only three digits show (like ICICI); they are kept as last4, and
  matching a three-digit last4 to a saved account is account-match's job (src/lib/CLAUDE.md). A NEFT alert also names
  the other party's account at their bank ("as NEFT from|to UTIB A/c ***2271 of NAME"): never last4.
- An outgoing NEFT reads "your NEFT transaction ... has been credited to the <bank> A/c XX<4> of NAME": an expense;
  the beneficiary's account is never last4, the person's own "A/c ...***-731" is kept when printed, and with none it
  goes to Review. Only an HSBC-format account after "credited to" with no "of NAME" after it (the person's own) makes
  it money back (income). An HSBC-format account followed by "of NAME" is someone else's and is never last4. Any
  failure or money-back word anywhere (the same list, the payee's name included) keeps it money out, held in Review (at most 0.75),
  without the beneficiary's digits.
- Card alerts ("Thank you for using HSBC ... Card"): line breaks end sentences. With no money-back word anywhere
  (any form of reverse or refund, reimbursed, chargeback, cancelled, voided, bounced, rolled back, adjusted back,
  re-credited, credited, a credit or Cr other than "Credit Card", returned, failed, declined) it is a spend at its normal score. With
  any, anywhere (a shop name, a help line or a promo included), the shared reading is kept but held in Review (at most
  0.75): never booked either way. A shop called "REFUND KITCHEN" and a cashback line therefore send a spend to Review
  (accepted noise). A status word after the shop ("ORCHID MART - REVERSED") is not part of the merchant.
- A card is read with four digits ("Credit Card XXXX6603", "creditcard xxxxx6603"); one masked to fewer
  ("XXXXX58xx"), or a card alert naming no card, gives no last4 (never digits from a ref). "Thank you for using HSBC ... Card" is money out unless the message says it was
  reversed, refunded or credited back. "Your HSBC creditcard ... payment of INR ... has been received" is a card bill
  payment (Review).
- Merchant: the other party after "of" on a NEFT alert, the beneficiary on an outgoing NEFT, a UPI id after "to", the
  payee after "towards" (mandate words and steps such as "set up for" or "verification" dropped), the shop after "used at" or "at", the payee after "paid from ... to";
  never a time of day ("at 10.02.11") or a cash deposit.

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
- A payment towards the card ("received a payment of INR ... towards your AMEX card", "Your payment of INR ... towards
  your American Express Card ending <5 digits> has been received") is a card bill payment: capped at 0.5, Review.

## Left out
- Citi: its Indian retail and card business moved to Axis Bank in 2023, and no Indian Citi SMS header could be
  confirmed, so it has no parser; Citi-branded alerts now come from Axis and use the Axis parser.
- Other headers seen for these banks abroad (Standard Chartered in Pakistan, Bangladesh, Nepal, Nigeria; HSBC in other
  countries) are not claimed.
