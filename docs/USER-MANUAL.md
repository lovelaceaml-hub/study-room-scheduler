# LV Zion Study Rooms — User Manual

This app lets LV Zion members reserve a study room, whiteboard, or TV for the
upcoming Tuesday or Saturday from one phone-friendly calendar.

The app is live at **https://lvrooms.web.app**. (The older address,
https://lvz-rooms.web.app, forwards there automatically.)

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

Choose one of these resource types:

- Study Rooms 1–4.
- Whiteboards 1–5. Each whiteboard remains paired with its same-numbered podium.
- TVs 1–3.

The Baptism Room is no longer part of scheduling and will not appear as an option.

Use the **Study room**, **Whiteboard**, or **TV** picker above the calendar to choose
which availability list to show. Each time row says how many units remain open.
Tap **View numbered units** when you need the secondary unit-by-unit detail. Pending
requests appear only in the request count because they do not own a numbered unit
until Admin approves and assigns one.

Open **My reservations** to see the status of every request made from this device and
recent **Schedule updates**, including Requested, Reserved, and Cancelled activity.

### Service periods and available times

Slots are 30 minutes long. The final reservable period is **9:30–10:00 PM**.

The schedule marks these service periods as blocked areas:

- **Tuesday:** 8:00–9:00 PM.
- **Saturday:** 9:00–10:00 AM, 3:00–4:00 PM, and 8:00–9:00 PM.

Saturday’s schedule begins at 9:00 AM so the morning service is visible, but
reservable time begins at 10:00 AM. Blocked service areas cannot be selected, and a
reservation cannot overlap or cross through one.

### Request a room or equipment

1. Open the app, choose Tuesday or Saturday, and choose the resource type.
2. Tap an open time on the left for the start time. Tap a later time in the same section to
   extend the reservation.
3. Tap **Continue**.
4. Enter your full name and choose Contact, New Member, Meeting, or Other.
   For Other, briefly explain the purpose.
5. Tap **Reserve now** on Tuesday or **Send request** on Saturday.

There is no separate **Sign up** screen. Starting with the calendar makes the time
you are requesting clear before you fill in the rest of the information.

The app shows a real saving message. When the online database confirms the request,
the app says it was saved. If saving fails, it explains that the request was not
submitted instead of pretending it succeeded.

No visible login is required. The app quietly gives the device a private member
identity so that it can recognize ownership. That device can cancel its own new
requests but cannot change another member’s request or perform approval actions.

### Tuesday and Saturday approval

Tuesday reservations from 10:00 AM through 10:00 PM are approved automatically when
a resource is free. Saturday reservations remain pending for manual approval. Saturday
requests are reviewed in this order: Contact, New Member, Meeting, Other;
the earlier request wins when two have the same purpose.

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

Saturday pending requests are listed by priority: Contact, New Member, Meeting, then
Other. Select a request in the priority queue to see its details, whole-range
availability, recommended numbered assignment, and day map together. You can change
the recommended unit before approving or declining.

## Preview sample information

To inspect the layout without changing the real schedule, add `?demo=1` to the end of
the app address. This shows clearly labeled sample reservations, requests, and a
cancelled item only in your browser.

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
