# Bank parsers: payment apps, wallets and card apps (ticket 175)

One section per parser: SMS headers it claims, the message shapes it reads (described in words, never a real
message), what it overrides, and anything left to the generic parser.

All of them extend `AppParser` (`banks/app-shared.ts`), which adds two rules to `KnownBankParser`:

- An app read with no account digits keeps no balance or limit (a wallet balance has no account to belong to) and is
  capped at 0.75, so it always goes to Review. Apps never invent digits they do not print.
- A payee never keeps a trailing " on <date> (at <time>)", a run of seven or more digits (a phone or account number)
  or a UPI id made only of digits (`cleanAppParty`).

"You've" is read with a straight or a curly apostrophe.

None of them claims an app package: the apps' own notifications (UPI payments, fund purchases, card bill payments)
keep reading through the shared rules exactly as before. Only the SMS headers below are claimed.

## PhonePe wallet (`phonepe_wallet`)

- Header: `PHONPE`.
- Reads only messages that name the PhonePe wallet: a payment from the wallet ("You've paid ... via PhonePe wallet for
  SHOP"), money added, credited or refunded to it. Anything else from PhonePe (a UPI payment from the bank) returns
  null, so the generic parser reads it as before; the bank's own message records that payment.
- Direction comes only from the words before "PhonePe wallet", so a shop with "REFUND" in its name stays a payment.
  Money coming back is tested first: "paid to RIDES was refunded to your PhonePe wallet" is income, and keeps RIDES.
- The amount, the verb and the payee come only from the sentence that names the wallet: "You've paid Rs.48 to SHOP.
  Cashback of Rs.5 credited to your PhonePe wallet." is a cashback of 5 (the payment of 48 left the bank, which
  records it).
- No account: every read goes to Review.

## Jupiter Edge (`jupiter`)

- Header: `JTEDGE` (the Edge CSB Bank RuPay credit card).
- "debited to your Edge ... Credit Card ending NNNN" is a spend on the card, never a payment to it.
- A credit to the card is a card bill payment (Review, at most 0.5) unless the sentence that holds the amount says
  refund, reversal or cashback; a promo line after it ("Earn cashback on every UPI spend") does not count.
- Its dates are month first ("11/5/26" is 5 November). The shared reader reads day first, so this parser reads them
  itself; a date more than ten minutes after the message arrived is not trusted and the received time is used.

## slice (`slice`)

- Headers: `SLCEIT`, `SLCBNK`.
- Reads a UPI "Sent ... to NAME (UPI ...)" (no account digits: Review), a credit card spend "spent on your credit card
  xxNNNN at SHOP", an online card transaction "slice credit card transaction of ... on SHOP is successful" (no debit
  word, read as a spend; no digits: Review), money in "You've got ... from NAME in(to) your slice bank a/c xxNNNN"
  (booked on that account, even when it came from the slice card), and an AutoPay debit from the account.
- Only that receipt shape of "You've got" is income: "You've got a new bill of ..." is not.
- A "Sent ... to" gives no account digits unless it says "from slice a/c" (the digits after "to" are the payee's), and
  its payee comes only from the position after "to".
- "Repayment of ... received for the slice credit card" is a card payment, never income.

## OneCard (`onecard`)

- Header: `ONECRD`.
- Its spends start "You've ..." and carry no debit word. Only spend verbs (made a transaction, booking, purchase or
  payment, fueled up, shopped, spent, paid, hand-picked ...) followed by "of/for <amount> at/on SHOP on card ending
  NNNN" are read as a spend on the card, and "on OneCard" is never the shop. A cashback, a refund, or a message that
  starts "You've converted" (an earlier purchase into EMI: no new money spent) goes through the shared rules; an offer
  to convert after a spend, or a shop called "EMI MART", does not stop it being a spend.
- "You've made a payment of ... on OneCard" is the card's bill paid: a card payment in Review.
- "Payment of ... received on card ending NNNN" is a card payment (the shared rule stops at the "." of "Rs.").

## CRED (`cred`)

- Header: `CREDIN`.
- Reads only a card bill paid through CRED ("Payment of ... has been successfully credited towards your <bank> Credit
  Card"), or a message the shared rule already calls a card payment: a card payment in Review. The bank on the parse is
  the card's ("ICICI Bank"), which helps the person pick the card. A cashback line after the bill shape does not change
  that.
- A spend made with a card ("payment of ... to SHOP using credit card") and a UPI payment through CRED return null, so
  the generic parser reads them as before.

## LazyPay (`lazypay`)

- Header: `LZYPAY`.
- A purchase on the pay-later line ("txn TXN... of ... on SHOP was successful") is a spend with its TXN id; it has no
  account number, so it goes to Review.
- A repayment ("Repayment of ...", "payment of ... received towards / against your LazyPay ...", "Your payment of ...
  on LazyPay was successful") settles the line like a card bill: a card payment in Review, never income. "LazyPay" is
  never read as the shop. Only a repayment that happened counts (received, successful, paid, done): an offer to repay
  or a pending repayment is not one.

## Amazon Pay balance through Juspay (`juspay`)

- Header: `JUSPAY`.
- Reads only messages that name the Amazon Pay balance: "Payment of ... using Apay Balance successful at SHOP" and
  "Your Apay Wallet balance is debited for ... Transaction Reference Number is ...". The updated balance is dropped
  (no account). Anything else returns null.

## Left out

- App packages (PhonePe `com.phonepe.app`, CRED `com.dreamplug.androidapp`): claiming them would change how those
  apps' own notifications read (a fund purchase notification would no longer be a fund note).
- Headers seen only rarely or not clearly the app's own: `ONECARD`, `APAY`, `JUPITER`, `SLICEIT` (seven letters, not a
  DLT header).
- Cashfree (`CSHFRE`): a gateway receipt repeats the payment the person's bank or UPI app records, and a pre-filled
  Review item would invite counting it twice, so no parser reads it; it goes to the generic parser as before.
