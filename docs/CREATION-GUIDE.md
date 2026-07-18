# LV Zion Study Rooms — Creation Guide

This guide explains the current design for the person who maintains or rebuilds the
app later. For everyday instructions, use the [User Manual](USER-MANUAL.md).

## What the app does

LV Zion Study Rooms is an installable web app for reserving study rooms and shared
equipment on the upcoming Tuesday and Saturday. Members request a resource type and
time; Admin assigns the exact unit and approves or declines the request.

The primary member address is **https://lvrooms.web.app**. The former address,
**https://lvz-rooms.web.app**, is a permanent redirect. Production deployment was
verified on July 17, 2026.

## Architecture

The app remains deliberately simple:

- Plain HTML, CSS, and JavaScript with no build step.
- Firebase Hosting for the website and installable app files.
- Firestore live listeners so all open screens update together.
- Anonymous Firebase identity for member ownership without a visible login.
- Protected Firebase backend actions for Admin authentication and changes.
- A service worker and local cache for installation and resilient reading.

The member interface and lobby display share booking data but use separate rendering.
The TV view is available at **https://lvrooms.web.app/?tv=1** and is intentionally
read-only.

### Visual design system

The July 17 redesign separates the visual styling from the page markup. `tokens.css`
holds the shared color, type, shape, and status-color choices; `styles.css` contains
the member and Admin components; and `tv.css` adds only the lobby display's timeline
layout on top of the same tokens. This keeps the member app and TV consistent in light
and dark display settings without changing any booking, approval, privacy, or
scheduling behavior. The service worker caches both shared style files, and Hosting
serves CSS without a long-lived cache so a new design reaches installed copies promptly.

## Scheduling rules

### Dates

Only two dates are offered: the upcoming Tuesday and upcoming Saturday. Today counts
when today is one of those weekdays. The dates are displayed chronologically and the
selected date is shared across Reservations and Admin. Reservations is the only
member booking screen; there is no separate Sign up tab.

### Time range and services

All reservable slots are 30 minutes. Booking begins at 10:00 AM and the final slot is
9:30–10:00 PM.

Unavailable service periods are:

- Tuesday: 8:00–9:00 PM.
- Saturday: 9:00–10:00 AM, 3:00–4:00 PM, and 8:00–9:00 PM.

Saturday’s visual schedule starts at 9:00 AM to show the morning service. Validation
must reject ranges that overlap a service or begin before reservable time.

### Member booking flow

The Reservations screen places Study room, Whiteboard, and TV calendars one below the
other, with the Tuesday/Saturday choice attached above them. The page scrolls vertically;
each calendar has time labels on the left and slim capacity squares on the right. The
member selects a 30-minute start and optionally extends the range before tapping
Continue. The short sheet then asks
only for name and purpose (Contact, New Member, Meeting, or Other). The time column,
not the unit cell, is the member’s selectable control; numbered unit cells show the
approved member and purpose.

Service periods remain visible as blocked calendar areas rather than separate notices
that say reservations are unavailable. They cannot be selected or crossed when a
member adjusts a booking length. The same interaction must work on phone layouts,
not only the desktop calendar.

### Resources

- Study Rooms 1–4.
- Whiteboards 1–5, with same-numbered podium pairing shown as information.
- TVs 1–3.

The Baptism Room is retired. It must not be offered in member preferences, Admin
assignments, capacity calculations, schedules, or TV mode. A future active booking
that still references it is returned to pending for reassignment; historical data may
retain the old identifier for records without making the room bookable again.

## Live booking behavior

Tuesday requests are created through a protected callable function, which assigns the
first free unit and approves the request in one transaction. Saturday requests stay
pending. The Admin queue and assignment recommendations sort Saturday requests by
Contact, New Member, Meeting, Other, then request time.

The activity feed derives Requested, Reserved, and Cancelled events from booking
timestamps. Approved cancellations retain their last assigned unit in server-only
write data so the feed can accurately say which room, whiteboard, or TV was cancelled.
`?demo=1` overlays fixed sample records in the browser only; it never writes them to
Firestore.

Approval performs a fresh conflict check, records the chosen assignment, and moves the
booking from the pending lane into the assigned row. Decline or cancellation removes
it from the active schedule. The UI reports saving, saved, failed, reconnecting, and
live states based on the actual result rather than assuming a write succeeded.

## Privacy and security model

### Members

Members do not create accounts or see a login screen. Firebase silently creates an
anonymous identity. New bookings store that owner identity along with update and
schema information. Database rules permit members to create valid pending requests
for the two allowed dates and cancel only their own eligible requests.

Members cannot approve, assign, decline, delete, change app settings, or edit another
member’s request. Legacy bookings without ownership remain readable and can be managed
by Admin, but are not claimed by whichever member happens to open them.

### Admin

The familiar PIN remains `0000`, but the webpage does not decide whether it is valid.
A protected Firebase backend verifies it, limits repeated attempts, and creates a
short-lived Admin session. Approval, decline, cancellation, reassignment, direct-add,
and cleanup actions run through protected backend operations with server-side conflict
checks.

Optional request notes live in an Admin-only location. Public schedule documents and
the TV cache do not contain those notes. The TV also excludes purposes, preferences,
PIN controls, and Admin actions.

## Lobby TV renderer

The TV renderer shows only the current local calendar day:

- Tuesday or Saturday: full timeline through 10:30 PM, service blocks, approved rows,
  pending lanes, current-time marker, clock, and connection status.
- Any other day: **No study-room schedule today**.

Public names are reduced to first name plus last initial. The display keeps a narrow
cache of only the information it needs. When Firestore disconnects, it preserves the
last schedule and shows **Reconnecting** and the last update time. The CSS has layouts
for 1920×1080 and 1280×720 lobby screens.

## Phone and accessibility design

The phone layout uses a compact two-column date selector and a compact, tappable
two-column time list. It opens the same short booking pop-up as the desktop view.
Main controls use at least 44×44-pixel touch targets.

Tabs and selected controls expose their state to assistive technology. Inputs have
real labels, status and error messages are announced, the masthead home behavior is
keyboard accessible, contrast remains readable, and layouts tolerate enlarged system
text and reduced motion.

## Testing expectations

Production verification covers:

- Upcoming-date calculation, including when today is Tuesday or Saturday.
- Every service block and rejection of crossing ranges.
- The final 9:30–10:00 PM slot.
- Four-room capacity and removal of every future Baptism Room path.
- Pending-to-approved, decline, cancel, reconnect, and failed-save transitions.
- Member ownership and rejection of unauthorized Admin or cross-member changes.
- Two simultaneous devices receiving live changes without refresh.
- Selecting an open calendar slot on desktop and phone opens a pop-up with the
  correct date and initial 30-minute range.
- A member can extend a request only within the same non-service period; blocked
  service areas cannot be selected.
- The calendar has no separate Sign up tab or "reservations unavailable" notice.
- Phones at 320, 375, and 390 pixels.
- TV mode at 1280×720 and 1920×1080.
- Old-address redirect, new primary address, installation, and offline reopening.

## Deployment order

Deployment should be staged so the browser never depends on backend protection that
is not present yet:

1. Deploy and verify protected backend functions.
2. Deploy the revised Hosting targets, including TV files and the shorter site.
3. Deploy restrictive Firestore rules.
4. Verify both addresses, live updates, Admin actions, anonymous member requests, and
   `?tv=1` in production.

Firebase Blaze billing is enabled for this project because protected functions and
Secret Manager require it. It uses the church's existing Firebase Payment account.
