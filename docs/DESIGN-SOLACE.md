# Solace

Solace treats the schedule as a boutique hospitality folio: a quiet, sticky invitation at the left and a softly rounded ivory booking surface at the right. On a phone, the welcome becomes a compact serif greeting and Reserve Now rests in a floating bottom dock.

The signature is calm depth. Open half hours are gently inset, while occupied cards rise above the paper with abbreviated fictional names and clearly written purposes. Sage date capsules, a pill resource rail, Georgia typography, and a small architectural ornament create a warm, domestic character. Motion rises a few pixels and settles, with a static reduced-motion equivalent.

The design avoids an editorial page stack, continuous colored column wells, decorative day cards, dense rules, oversized counters, and operations-console styling.

## Prototype

- Entry: [Solace prototype](../design/prototypes/reserve-now-solace/index.html)
- Styles: [Solace CSS](../design/prototypes/reserve-now-solace/solace.css)
- Behavior: [Solace JavaScript](../design/prototypes/reserve-now-solace/solace.js)
- Loading: append `?state=loading`, then choose Show sample schedule.
- Empty: append `?state=empty`, then choose Show sample bookings or make a reservation.
- Recoverable error: append `?state=error`, then choose Try again.

The complete vertical schedule spans 10:00 AM to 11:00 PM in 30-minute slots. Study Rooms has four columns, Whiteboards five, and TVs three. Dates are the next Tuesday and Saturday, including today, calculated for Los Angeles. Saturday services are 10:00 AM to 11:00 AM, 2:30 PM to 3:30 PM, and 7:30 PM to 8:30 PM. Tuesday service is 7:30 PM to 8:30 PM.

Reserve Now asks for resource, purpose, start, end, fictional name, and confirmation. A direct open slot preserves its exact resource, unit, date, and start, then asks purpose and end. Endings stop at conflicts, service, and closing. General bookings receive a unit that stays available for the complete range. The success screen updates the visible schedule and links back to the saved card.

All data is fictional. Reservations are held only in JavaScript memory and clear on refresh. There are no external assets, storage writes, network requests, Firebase calls, or production changes. A native modal dialog provides focus containment, Escape closing, explicit back and close controls, and focus restoration. Open half-hour targets are 44 pixels or taller, and the schedule keeps all resource columns within the phone width.

## Delivery boundary

This lane creates only the Solace prototype and this concept note. Controller owns browser smoke checks, preview deployment, source receipts, and any final user-facing comparison. No review, deployment, commit, push, or additional agent work ran in this lane.
