# LV Zion Study Rooms — User Manual

> **Current service:** This Firebase Study Rooms scheduler remains live at
> https://lvrooms.web.app. LV Zion Study Rooms is also active at
> https://lvzion.vercel.app/rooms. They are separate calendars and do not
> synchronize reservations.

This app lets LV Zion members reserve a study room, whiteboard, or TV for the
upcoming Tuesday or Saturday from one phone-friendly calendar.

The established Firebase service is **https://lvrooms.web.app**. Use
**https://lvrooms.web.app/?tv=1** for this scheduler's lobby display.

> Release note: the mobile, approval, TV-day-picker, expanded mock-data, simplified
> Home, compact reservation rows, and study-room-focused TV changes below were deployed
> and live-verified on July 20, 2026. The Home-first booking update below was deployed
> and live-verified on July 21, 2026. The same day's annotation refinement—independently
> scrolling Live updates, count-free resource controls, the masthead Schedule link,
> compact reservation cards, and no Admin Recent updates feed—is also live. A separate
> mobile display/feed-order follow-up is also live: it keeps narrow-phone time labels
> on one line and puts the newest Live update first. A further mobile grid-density
> follow-up is also live: it keeps Home tiles compact and evenly spaced while preserving
> readable names and short purpose labels. The September 11, 2026 update replaces the
> July 22 selection bar with a confirmation popup, shows the whole day as one schedule
> instead of three boxes, colors reservations by purpose, and lets a Contact or New
> Member take a time held for Other. The July 26, 2026 update removes approval from every
> day—Tuesday and Saturday reservations are now confirmed the moment they are made—and
> adds **End early**, so a member who finishes ahead of time can release the rest of
> their reservation.

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
selected range bar stays on the viewing screen, so you can scroll the schedule without
losing **Clear** or **Continue**.

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

The availability result includes a button with the number of units still open. Tap it to
see who has each numbered room or item for that range.

Open **My reservations** to see the status of every request made from this device.

### Service periods and available times

Slots are 30 minutes long. Booking begins at **10:00 AM** and the final reservable period
is **10:30–11:00 PM**. The evening list therefore includes **10:00 PM** and **10:30 PM**
as start times.

The Home overview shows the whole day in one schedule, with these service periods
marked in place (new times, starting 12 September 2026):

- **Tuesday:** 7:30–8:30 PM.
- **Saturday:** 10:00–11:00 AM, 2:30–3:30 PM, and 7:30–8:30 PM.

Because Saturday's morning service runs 10:00–11:00 AM, the first Saturday reservation
starts at 11:00 AM.

Service time does not appear as a selectable member slot. A reservation cannot overlap
or cross through one. The lobby TV still shows each service as a labeled timetable band.

### Request a room or equipment

1. On **Home**, use the arrows to choose Tuesday or Saturday and choose the resource type.
2. Open Morning, Afternoon, or Evening; use the scroll cue when more times are below.
3. Tap an open **Start time**, then answer **When should it end?** with the exact
   **End time**. Choosing 10:00 AM and
   11:30 AM creates a 10:00–11:30 AM reservation—not 10:00 AM–12:00 PM.
4. Tap the open total if you need to see the numbered assignments for that range.
5. Tap **Continue** in the selected range bar. It stays visible while you scroll the
   schedule.
6. Enter your full name and choose Contact, New Member, Meeting, or Other.
   For Other, briefly explain the purpose.
7. Tap **Reserve now**. The room or item is yours immediately—there is nothing to wait
   for.

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

### No approval on any day

**Nobody waits for approval.** Every reservation—Tuesday or Saturday, made weeks ahead or
on the day itself—is confirmed the moment it is made and appears on the schedule with its
numbered room or item straight away.

Availability is the only gate. A reservation cannot be made when every numbered unit is
already taken for part of the chosen range; the app says so and offers the longest
shorter ending that is still free.

Requests submitted before this change that are still waiting are not lost. They stay in
the Admin queue and can be approved there as before.

### Check, shorten, or cancel your reservation

Your reservations appear under **My reservations** on the device used to make them.
Possible statuses are:

- **Approved:** assigned to a specific room or item.
- **Cancelled:** withdrawn by the member or Admin.
- **Requested — awaiting approval:** only older requests made before approval was
  removed.

Each reservation uses a compact card with its date, time, status, resource, and purpose.

**Finished early?** Tap **End early** on the reservation, then choose the time you
actually finished—for example, ending a 10:00 AM–12:30 PM reservation at 12:00 PM. The
remaining time is released immediately, so Home and the lobby TV show the room as
available. On the day itself, the choice matching the current time is marked **now**. Your
reservation stays on your list with a note of what you originally booked. A reservation
that is only 30 minutes long has nothing to shorten, so it offers only **Cancel**.

Use the destructive **Cancel reservation** button when your plans change entirely.
Cancelling removes it from the live schedule. Older reservations created before secure
ownership was added may require Admin to make changes.

## For the approver

### Unlock Admin

1. Open **Admin**.
2. Enter the administrator PIN from the active provider-managed secret store. Never copy its value into documentation.
3. Tap **Unlock**.

The browser sends the PIN to a protected Firebase service for validation. The PIN is
not trusted merely because it was typed into the webpage. A successful unlock creates
a short-lived Admin session, and repeated incorrect attempts are limited.

### Manage the day

New reservations arrive already confirmed and assigned, so the queue is normally empty.
It still holds any request made before approval was removed: select it to see its
details, whole-range availability, recommended numbered assignment, and day map
together, and change the recommended unit before approving or declining.

In the day list, each approved booking offers **End early** as well as **Cancel**. Use
**End early** when someone tells you in person that they have finished, and choose the
time they finished; the rest of their time is released for everyone. The Admin workspace
does not include a separate Recent updates feed; the queue and day overview provide the
operational context.

## Preview sample information

To inspect the layout without changing the real schedule, add `?demo=1` to the end of
the app address. The browser-only preview includes sample room, whiteboard, and TV
assignments; a full period; a cancelled reservation; and both eligible days. It never
writes mock information to Firestore, so **End early** and **Reserve now** only show the
sample message there.

Cancelling or ending early removes that time from the active public schedule. Protected
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
