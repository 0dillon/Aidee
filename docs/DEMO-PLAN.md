# Demo plan

Pitch: any platform becomes voice-native through our SDK. Built for blind, visually impaired and low-literacy callers.

Entry point: dashboard tab "Call a number". Enter a judge's number, press Call now, Aide rings them.

## Use case 1: voice onboarding (go first, must work)
1. Aide greets in plain words and explains why it needs a name and phone number.
2. Caller says their name and number. Aide reads both back, one digit at a time, and asks for a clear yes.
3. Aide calls `create_account`. The new customer appears on the Customers page while the call is still live.
4. Aide says what happens next and ends the call.
Do not ask for BVN, NIN, PIN, card or OTP. Identity checks and a safe phrase are the next step, not part of the demo.

## Use case 2: order and callback (only if use case 1 is clean)
Product questions, postcode lookup, pay-on-delivery order, then a callback within 90 seconds for a rating, promo interest and an optional reminder.

## Safety moment (inside either call)
On an unusual request Aide slows down, reads the details back twice and needs a clear yes both times.

## Limits
- Minutes: Starter plan showed 200 telephony minutes (unconfirmed). Plan about 30 calls total.
- Say "same SDK pattern for banks", not a live bank integration.
