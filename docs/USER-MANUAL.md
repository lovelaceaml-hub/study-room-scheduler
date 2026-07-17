# LV Zion Study Rooms — User Manual

This app lets LV Zion members request a study room for the upcoming Tuesday or
Saturday. A whiteboard or TV can be added when needed. Requests appear on the
shared schedule immediately, even before an approver assigns a specific room or item.

The revised version is still being prepared for deployment. Its primary address
will be **https://lvrooms.web.app**.

## For members

### Choose a day

The app shows only two dates:

- The upcoming Tuesday.
- The upcoming Saturday.

If today is Tuesday or Saturday, today counts as the upcoming date. The two dates
are shown in calendar order and have distinct Tuesday and Saturday styling.

### Choose a time

Open **Reservations**, then choose Tuesday or Saturday. Reservations is the member
booking screen. The selected date also stays the same when you move to Admin.

The schedule has separate sections for:

- Study Rooms 1–4.
- Whiteboards 1–5. Each whiteboard remains paired with its same-numbered podium.
- TVs 1–3.

The Baptism Room is no longer part of scheduling and will not appear as an option.

The first screen shows only what is needed to book quickly: the two available dates
and a simple list of 30-minute times. Each time says how many study rooms are open.
Tap an open time to begin a request. If you need to check individual rooms or the
shared equipment, open **View room-by-room schedule** below the time list.

Green reservations are approved. Requests that are still waiting for review remain
visible in the detailed schedule; a request never guarantees a particular room until
an approver assigns it.

### Service periods and available times

Slots are 30 minutes long. The final reservable period is **10:00–10:30 PM**.

The schedule marks these service periods as blocked areas:

- **Tuesday:** 8:00–9:00 PM.
- **Saturday:** 9:00–10:00 AM, 3:00–4:00 PM, and 8:00–9:00 PM.

Saturday’s schedule begins at 9:00 AM so the morning service is visible, but
reservable time begins at 10:00 AM. Blocked service areas cannot be selected, and a
reservation cannot overlap or cross through one.

### Request a room or equipment

1. Open the app and choose the upcoming Tuesday or Saturday.
2. Tap an open 30-minute time. A pop-up opens with that date
   and time already selected.
3. Enter your full name.
4. A study room is included automatically. Add a **Whiteboard** or **TV** only if you
   need one.
5. If needed, adjust the end time in the pop-up. You can extend only through open
   30-minute periods in the same available section.
6. Tap **Request this time**. Open **More details** only when you want to add a room
   preference, change the purpose or certainty, or leave a note.

There is no separate **Sign up** screen. Starting with the calendar makes the time
you are requesting clear before you fill in the rest of the information.

The app shows a real saving message. When the online database confirms the request,
the app says it was saved. If saving fails, it explains that the request was not
submitted instead of pretending it succeeded.

No visible login is required. The app quietly gives the device a private member
identity so that it can recognize ownership. That device can cancel its own new
requests but cannot change another member’s request or perform approval actions.

### Check or cancel your request

Your requests appear under **My requests** on the device used to submit them.
Possible statuses include:

- **Requested — awaiting approval:** visible to everyone but not assigned.
- **Approved:** assigned to a specific room or item.
- **Declined:** not approved.
- **Cancelled:** withdrawn by the member or Admin.

Use **Cancel** when your plans change. Cancelling removes the active request from the
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

Pending requests show what the member needs, their requested time, and the details
needed for review. Choose an available Study Room 1–4, whiteboard, or TV for every
requested type, then approve or decline the request.

Approval moves the booking live from the amber request lane into its assigned green
row. Declining or cancelling removes it from the active public schedule. Protected
backend checks prevent two people from being assigned the same item at the same time.

Optional member notes are visible only to Admin. They are not included in the public
schedule or lobby display.

Use **Lock admin** when finished, especially on a shared device.

## Lobby TV screen

Open **https://lvrooms.web.app/?tv=1** on the lobby display.

- On Tuesday or Saturday, it shows today’s complete timeline only.
- On other days, it says **No study-room schedule today**.
- It includes the current time, service periods, approved assignments, pending
  request lanes, and live connection status.
- Names use first name plus last initial, such as **Anthony L.**
- It never shows notes, purposes, room preferences, the Admin PIN, or Admin controls.
- If the connection drops, it keeps the last known schedule visible and shows
  **Reconnecting** with the last successful update time.

The TV screen is designed for 1920×1080 and remains usable at 1280×720.
