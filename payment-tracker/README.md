# Payday Ledger

A personal monthly payment tracker built around a salary cycle rather than the
calendar month. Salary lands on the 28th, the cycle runs 28th → 27th, and every
credit card, loan and bill due in between is tracked against it.

`index.html` is the whole app — one file, no build step, no server, no account.
Open it in any browser, on a laptop or a phone.

## What it shows

- **Salary in** for the cycle, and **what is left after every payment** is made.
- A **payment calendar** for the cycle: one dot per payment, placed on its due
  date, sized by amount, coloured by category, with today marked.
- **Total going out / paid so far / still to pay / overdue.**
- **Where the salary goes** — the whole salary split across credit cards, loans,
  bills, rent and whatever is left over.
- Payments grouped **overdue → due within 7 days → later this cycle → paid**.

## Using it

- **Set your salary**: click the big number and type it. Each cycle keeps its own
  figure; a new cycle starts from the last one you entered.
- **Add a payment**: name, amount, the day of the month it is due, and a
  category. Payments repeat every month by default; choose *This cycle only* for
  a one-off.
- **Mark one paid**: tick the box on its row.
- **Change one amount for one cycle only** (a card statement varies month to
  month): click the amount on the row. The monthly default is untouched.
- **Edit or delete**: click anywhere on the payment's name.
- **Move between cycles**: the arrows in the header; the clock icon returns to
  the current one.

It opens seeded with CBD, ADCB, DIB and Mashreq cards, a loan and a mobile bill,
all at zero — fill in the amounts and due days, or delete what does not apply.

## How the cycle works

The cycle runs from your salary day to the day before the next one. A payment
due *before* the salary day is counted in the following month, because that is
when you actually pay it out of that salary. Short months are handled: with a
salary day of 31, February's cycle starts on the 28th, and a payment whose due
date would fall outside the cycle is pinned to the cycle's edge so it is never
counted twice or missed.

Change the salary day and the currency under the gear icon.

## Where the data lives

Everything is stored in the browser's local storage on the device you use it on.
Nothing is sent anywhere, and there is no account.

Under the gear icon there is a **Backup** box holding the full JSON: copy or
download it to keep a copy, or paste one in and press *Restore from box* to move
your data to another browser or phone.

Published as a Claude Artifact, the app also syncs through the artifact's own
private store, so the same figures appear on every device you open it on.
