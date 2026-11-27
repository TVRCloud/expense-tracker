# Bank parsers: payment apps, wallets and card apps (ticket 175)

One section per parser: SMS headers it claims, the message shapes it reads (described in words, never a real
message), what it overrides, and anything left to the generic parser.

All of them extend `AppParser` (`banks/app-shared.ts`), which adds two rules to `KnownBankParser`:

- An app read with no account digits keeps no balance or limit (a wallet balance has no account to belong to) and is
  capped at 0.75, so it always goes to Review. Apps never invent digits they do not print.
- `ceiling` caps every read of one app (Cashfree: 0.5).

None of them claims an app package: the apps' own notifications (UPI payments, fund purchases, card bill payments)
keep reading through the shared rules exactly as before. Only the SMS headers below are claimed.

## PhonePe wallet (`phonepe_wallet`)

- Header: `PHONPE`.
- Reads only messages that name the PhonePe wallet: a payment from the wallet ("You've paid ... via PhonePe wallet for
  SHOP"), money added, credited or refunded to it. Anything else from PhonePe (a UPI payment from the bank) returns
  null, so the generic parser reads it as before; the bank's own message records that payment.
- Direction comes only from the words before "PhonePe wallet", so a shop with "REFUND" in its name stays a payment.
- No account: every read goes to Review.

## Jupiter Edge (`jupiter`)

- Header: `JTEDGE` (the Edge CSB Bank RuPay credit card).
- "debited to your Edge ... Credit Card ending NNNN" is a spend on the card, never a payment to it.
- A credit to the card is a card bill payment (Review, at most 0.5) unless it says refund, reversal or cashback.
- Its date is written month first ("3/18/26"); the shared date reader does not read it, so the received time is used.

## slice (`slice`)

- Headers: `SLICEIT`, `SLCEIT`, `SLCBNK`.
- Reads a UPI "Sent ... to NAME (UPI ...)" (no account digits: Review), a credit card spend "spent on your credit card
  xxNNNN at SHOP", an online card transaction "slice credit card transaction of ... on SHOP is successful" (no debit
  word, read as a spend; no digits: Review), money in "You've got ... from NAME in your slice bank a/c xxNNNN", and
  an AutoPay debit from the account.
- "Repayment of ... received for the slice credit card" is a card payment, never income.

## OneCard (`onecard`)

- Header: `ONECRD`.
- Its spends start "You've ..." and carry no debit word ("made a transaction of ... on SHOP on card ending NNNN",
  "fueled up for ... at PUMP on card ending NNNN"): that shape is read as a spend on the card. A refund or anything
  else goes through the shared rules.

## CRED (`cred`)

- Header: `CREDIN`.
- Reads only a card bill paid through CRED ("Payment of ... has been successfully credited towards your <bank> Credit
  Card"), or a message the shared rule already calls a card payment: a card payment in Review. The bank on the parse is
  the card's ("ICICI Bank"), which helps the person pick the card.
- A spend made with a card ("payment of ... to SHOP using credit card") and a UPI payment through CRED return null, so
  the generic parser reads them as before.

## LazyPay (`lazypay`)

- Header: `LZYPAY`.
- A purchase on the pay-later line ("txn TXN... of ... on SHOP was successful") is a spend with its TXN id; it has no
  account number, so it goes to Review.
- A repayment ("Repayment of ...", "payment of ... received towards your LazyPay ...") settles the line like a card
  bill: a card payment in Review, never income.

## Amazon Pay balance through Juspay (`juspay`)

- Header: `JUSPAY`.
- Reads only messages that name the Amazon Pay balance: "Payment of ... using Apay Balance successful at SHOP" and
  "Your Apay Wallet balance is debited for ... Transaction Reference Number is ...". The updated balance is dropped
  (no account). Anything else returns null.

## Cashfree (`cashfree`)

- Header: `CSHFRE` (written `CSHfre` in some headers; matched without case).
- Reads only its payment receipt ("Payment INR ... (ID:...) confirmed for order #... on SHOP"). A receipt repeats the
  payment the person made from a bank, card or UPI app, and both arrive as SMS, which ingest does not match against
  each other, so the read is always kept in Review (at most 0.5) with the shop named. Anything else returns null.

## Left out

- App packages (PhonePe `com.phonepe.app`, CRED `com.dreamplug.androidapp`): claiming them would change how those
  apps' own notifications read (a fund purchase notification would no longer be a fund note).
- Headers seen only rarely or not clearly the app's own: `ONECARD`, `APAY`, `JUPITER`.
