# LV Zion Study Rooms — User Manual

This app lets LV Zion members reserve a study room, whiteboard, or TV for the
upcoming Tuesday or Saturday from one phone-friendly calendar.

The app is live at **https://lvrooms.web.app**. (The older address,
https://lvz-rooms.web.app, forwards there automatically.)

> Release note: the mobile, approval, TV-day-picker, and expanded mock-data changes
> below are prepared for the next release. They are not deployed to the live address yet.

## For members

### Home dashboard

The app opens on **Home**. Its day overview shows Study Rooms 1–4 by default. On a
Tuesday or Saturday it shows who is using each room now and when the reservation ends;
otherwise it shows the next reservation day and each unit’s next booking. Choose
**Whiteboard** or **TV** when you want those unit details. In the next release, an open
time in this overview is a button: it opens **Reservations** with that day, resource,
and start time highlighted, ready for the member to choose an ending.

**My notifications** shows updates for reservations made from this device. It calls out
pending requests, the next approved reservation, and denied requests without exposing
another member’s private reservation status.

**Live updates** is a scrollable box containing the latest Requested, Reserved, and
Cancelled activity. It updates automatically without making the page grow indefinitely.

### Choose a day

Reservations offers only two dates:

- The upcoming Tuesday.
- The upcoming Saturday.

If today is Tuesday or Saturday, today counts as the upcoming date. The two dates
remain available through the end of that day. Use the left and right arrows to step
between them. The selected date controls every availability and time shown below it.

### Choose a time

Open **Reservations**, then choose Tuesday or Saturday. Reservations is the member
booking screen. The selected date also stays the same when you move to Admin.

Choose one of these resource types:

- Study Rooms 1–4.
- Whiteboards 1–5. Each whiteboard remains paired with its same-numbered podium.
- TVs 1–3.

The Baptism Room is no longer part of scheduling and will not appear as an option.

Use the **Study room**, **Whiteboard**, or **TV** picker above the time menus. Open
**Morning**, **Afternoon**, or **Evening**, then tap one vertically stacked start time,
such as **10:00 AM**, **10:30 AM**, or **11:00 AM**. A small prompt asks **When should
it end?** Choose the exact ending.

The availability result includes a button with the open and pending totals. Tap it to
see who has each numbered room or item, plus every overlapping pending request. Pending
requests are explicitly marked unassigned because they do not own a numbered unit until
Admin approves and assigns one.

Open **My reservations** to see the status of every request made from this device.

### Service periods and available times

Slots are 30 minutes long. Booking begins at **10:00 AM** and the final reservable period
is **10:30–11:00 PM**. The evening list therefore includes **10:00 PM** and **10:30 PM**
as start times.

The reservation menus are divided around these service periods:

- **Tuesday:** 8:00–9:00 PM.
- **Saturday:** 9:00–10:00 AM, 3:00–4:00 PM, and 8:00–9:00 PM.

Service time does not appear as a selectable member slot. A reservation cannot overlap
or cross through one. The lobby TV still shows each service as a labeled timetable band.

### Request a room or equipment

1. Open **Reservations**, use the arrows to choose Tuesday or Saturday, and choose the resource type.
2. Open Morning, Afternoon, or Evening.
3. Tap the listed **Start time**, then answer **When should it end?** with the exact
   **End time**. Choosing 10:00 AM and
   11:30 AM creates a 10:00–11:30 AM reservation—not 10:00 AM–12:00 PM.
4. Tap the open/pending totals if you need to see numbered assignments and unassigned
   pending requests for that range.
5. Tap **Continue**.
6. Enter your full name and choose Contact, New Member, Meeting, or Other.
   For Other, briefly explain the purpose.
7. Tap **Reserve now** when the selected request qualifies for instant approval, or
   **Send request** when it needs Admin review.

If no single unit remains open for the entire range, the app says that none are
available in the selected time slot. When the same start has a shorter open range, it
asks whether you want that shorter ending instead. Choose **Yes** to use it or **No**
to choose another time.

There is no separate **Sign up** screen. Starting with the calendar makes the time
you are requesting clear before you fill in the rest of the information.

The app shows a real saving message. When the online database confirms the request,
the app says it was saved. If saving fails, it explains that the request was not
submitted instead of pretending it succeeded.

No visible login is required. The app quietly gives the device a private member
identity so that it can recognize ownership. That device can cancel its own new
requests but cannot change another member’s request or perform approval actions.

### Tuesday and Saturday approval

Tuesday reservations from 10:00 AM through 11:00 PM are approved automatically when a
resource is free. A Saturday reservation submitted **on that Saturday at or after 10:00
AM Los Angeles time** is also approved automatically when open. A Saturday request made
in advance remains pending for manual approval; it stays pending even when Saturday
arrives. A request cannot be submitted when every numbered unit is already occupied for
part of the selected range. Pending Saturday requests are reviewed in this order:
Contact, New Member, Meeting, Other; the earlier request wins when two have the same
purpose.

### Check or cancel your request

Your requests appear under **My reservations** on the device used to submit them.
Possible statuses include:

- **Requested — awaiting approval:** visible to everyone but not assigned.
- **Approved:** assigned to a specific room or item.
- **Declined:** not approved.
- **Cancelled:** withdrawn by the member or Admin.

Use **Cancel request** or **Cancel reservation** when your plans change. Cancelling removes the active request from the
live schedule. Older requests created before secure ownership was added may require
Admin to make changes.

## For the approver

### Unlock Admin

1. Open **Admin**.
2. Enter the familiar PIN, **0000**.
3. Tap **Unlock**.

The browser sends the PIN to a protected Firebase service for validation. The PIN is
not trusted merely because it was typed into the webpage. A successful unlock creates
a short-lived Admin session, and repeated incorrect attempts are limited.

### Review and assign requests

Advance Saturday requests that remain pending are listed by priority: Contact, New
Member, Meeting, then Other. Select a request in the priority queue to see its details,
whole-range availability, recommended numbered assignment, and day map together. You
can change the recommended unit before approving or declining.

## Preview sample information

To inspect the layout without changing the real schedule, add `?demo=1` to the end of
the app address. The next release fills the browser-only preview with sample room,
whiteboard, and TV assignments; pending requests; a full period; declined and cancelled
requests; and both eligible days. It never writes mock information to Firestore.

Approval moves the booking live from the amber request lane into its assigned green
row. Declining or cancelling removes it from the active public schedule. Protected
backend checks prevent two people from being assigned the same item at the same time.

Optional member notes are visible only to Admin. They are not included in the public
schedule or lobby display.

Use **Lock admin** when finished, especially on a shared device.

## Lobby TV screen

Open **https://lvrooms.web.app/?tv=1** on the lobby display.

- Choose an eligible Tuesday or Saturday with the TV day setting. The chosen day’s
  complete timeline remains visible; on a non-schedule day, choose the next eligible day
  instead of seeing an empty timetable.
- It includes the current time, service periods, approved assignments, pending
  request lanes, and live connection status.
- Names use first name plus last initial, such as **Anthony L.**
- It never shows notes, purposes, room preferences, the Admin PIN, or Admin controls.
- If the connection drops, it keeps the last known schedule visible and shows
  **Reconnecting** with the last successful update time.

Use TV demo mode when you want to inspect a filled schedule without real reservations.
Its mock entries are browser-only and include approved assignments, pending lanes, and
service bands.

The TV screen is designed for 1920×1080 and remains usable at 1280×720.
