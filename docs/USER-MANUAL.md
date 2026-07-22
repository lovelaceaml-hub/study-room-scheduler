# LV Zion Study Rooms — User Manual

This app lets LV Zion members reserve a study room, whiteboard, or TV for the
upcoming Tuesday or Saturday from one phone-friendly calendar.

The app is live at **https://lvrooms.web.app**. (The older address,
https://lvz-rooms.web.app, forwards there automatically.)

> Release note: the mobile, approval, TV-day-picker, expanded mock-data, simplified
> Home, compact reservation rows, and study-room-focused TV changes below were deployed
> and live-verified on July 20, 2026. The Home-first booking update below was deployed
> and live-verified on July 21, 2026. The same day's annotation refinement—independently
> scrolling Live updates, count-free resource controls, the masthead Schedule link,
> compact reservation cards, and no Admin Recent updates feed—is also live. A separate
> mobile display/feed-order follow-up is also live: it keeps narrow-phone time labels
> on one line and puts the newest Live update first. A further mobile grid-density
> follow-up is also live: it keeps Home tiles compact and evenly spaced while preserving
> readable names and short purpose labels. The July 22 selection-bar update is live as
> well: after an exact end time is chosen, the Clear and Continue actions remain visible
> while the schedule is scrolled.

## For members

### Home dashboard

The app opens on **Home**, which is the only member booking screen on phone and desktop.
It begins with two compact **Live updates** rows showing Requested, Reserved, or
Cancelled activity, with the newest status change first. When there are more updates,
the two-row area scrolls independently instead of making Home longer. Below it is the
Day overview, showing Study Rooms 1–4 by
default. Choose **Whiteboard** or **TV** when you want those unit details, use the
single-date arrows to choose Tuesday or Saturday, then open **Morning**, **Afternoon**,
or **Evening**. Each section shows its service band and half-hour grid, with a visible
scroll cue when more times are below. Occupied cells show the member name and purpose;
service cells remain informational.

The resource buttons use the simple labels **Study room**, **Whiteboard**, and **TV**;
they do not show a count. The compact controls still have a 44px minimum touch target.
Select **Schedule** in the masthead to open the read-only public lobby-TV schedule. It
does not start or change a reservation.

On a narrow phone, each Day overview time stays on one line in a compact time column so
the room tiles remain usable. This is only a layout adjustment; the same open-cell,
end-time, and availability flow applies.

The mobile-density refinement keeps Home tiles evenly spaced with a 44px minimum touch
target, retains the 58px single-line time column, and fits occupied cells with 10px
names plus 8.5px purpose labels that shorten with an ellipsis when needed. It does not
change what a reservation means or how members start one.

Tap an open cell to choose its start. Answer **When should it end?**, review the exact
range and availability, then tap **Continue** for the name-and-purpose form. The
availability details keep pending requests explicitly unassigned until Admin approves
one. The selected range bar stays on the viewing screen, so you can scroll the schedule
without losing **Clear** or **Continue**.

### Choose a day

Home's one-date arrow stepper offers only two dates:

- The upcoming Tuesday.
- The upcoming Saturday.

If today is Tuesday or Saturday, today counts as the upcoming date. The two dates
remain available through the end of that day. Use the left and right arrows to step
between them. The selected date controls every availability and time shown below it.

### Choose a time

Choose Tuesday or Saturday on Home, then choose the resource type you need. The selected
Home date is independent of the date Admin is reviewing.

Choose one of these resource types:

- Study Rooms 1–4.
- Whiteboards 1–5. Each whiteboard remains paired with its same-numbered podium.
- TVs 1–3.

The Baptism Room is no longer part of scheduling and will not appear as an option.

Use the **Study room**, **Whiteboard**, or **TV** picker above the Day overview. Open
**Morning**, **Afternoon**, or **Evening**, scroll within that section when its cue says
there are more times, and tap an open cell. A small prompt asks **When should it end?**
Choose the exact ending.

The availability result includes a button with the open and pending totals. Tap it to
see who has each numbered room or item, plus every overlapping pending request. Pending
requests are explicitly marked unassigned because they do not own a numbered unit until
Admin approves and assigns one.

Open **My reservations** to see the status of every request made from this device.

### Service periods and available times

Slots are 30 minutes long. Booking begins at **10:00 AM** and the final reservable period
is **10:30–11:00 PM**. The evening list therefore includes **10:00 PM** and **10:30 PM**
as start times.

The Home overview is divided around these service periods:

- **Tuesday:** 8:00–9:00 PM.
- **Saturday:** 9:00–10:00 AM, 3:00–4:00 PM, and 8:00–9:00 PM.

Service time does not appear as a selectable member slot. A reservation cannot overlap
or cross through one. The lobby TV still shows each service as a labeled timetable band.

### Request a room or equipment

1. On **Home**, use the arrows to choose Tuesday or Saturday and choose the resource type.
2. Open Morning, Afternoon, or Evening; use the scroll cue when more times are below.
3. Tap an open **Start time**, then answer **When should it end?** with the exact
   **End time**. Choosing 10:00 AM and
   11:30 AM creates a 10:00–11:30 AM reservation—not 10:00 AM–12:00 PM.
4. Tap the open/pending totals if you need to see numbered assignments and unassigned
   pending requests for that range.
5. Tap **Continue** in the selected range bar. It stays visible while you scroll the
   schedule.
6. Enter your full name and choose Contact, New Member, Meeting, or Other.
   For Other, briefly explain the purpose.
7. Tap **Reserve now** when the selected request qualifies for instant approval, or
   **Send request** when it needs Admin review.

If no single unit remains open for the entire range, the app says that none are
available in the selected time slot. When the same start has a shorter open range, it
asks whether you want that shorter ending instead. Choose **Yes** to use it or **No**
to choose another time.

There is no separate **Reservations** or **Sign up** screen. Starting from Home's day
map makes the time you are requesting clear before you fill in the rest of the
information.

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

Each request uses a compact card with its date, time, status, resource, and purpose.
Use the separate destructive **Cancel request** or **Cancel reservation** button when
your plans change. Cancelling removes the active request from the live schedule. Older
requests created before secure ownership was added may require Admin to make changes.

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
can change the recommended unit before approving or declining. The Admin workspace does
not include a separate Recent updates feed; the queue and day overview provide the
operational context.

## Preview sample information

To inspect the layout without changing the real schedule, add `?demo=1` to the end of
the app address. The browser-only preview includes sample room, whiteboard, and TV
assignments; pending requests; a full period; declined and cancelled requests; and both
eligible days. It never writes mock information to Firestore.

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
- It leads with four study-room availability cards and an approved-reservations-only
  supporting timeline. It includes service periods and live connection status.
- Names use first name plus last initial, such as **Anthony L.**
- It never shows notes, purposes, room preferences, the Admin PIN, or Admin controls.
- If the connection drops, it keeps the last known schedule visible and shows
  **Reconnecting** with the last successful update time.

Use TV demo mode when you want to inspect a filled schedule without real reservations.
Its mock entries are browser-only and include approved study-room assignments and
service bands.

The TV screen is designed for 1920×1080 and remains usable at 1280×720.
