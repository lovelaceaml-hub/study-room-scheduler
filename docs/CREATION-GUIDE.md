# LV Zion Study Rooms — Creation Guide

This guide explains the current design for the person who maintains or rebuilds the
app later. For everyday instructions, use the [User Manual](USER-MANUAL.md).

## What the app does

LV Zion Study Rooms is an installable web app for reserving study rooms and shared
equipment on the upcoming Tuesday and Saturday. Members request a resource type and
time. Tuesday is assigned and approved automatically when open. Saturday is assigned
and approved automatically only for a submission made on that Saturday at or after
10:00 AM Los Angeles time; an advance Saturday request stays pending for Admin to assign
or decline.

The primary member address is **https://lvrooms.web.app**. The former address,
**https://lvz-rooms.web.app**, is a permanent redirect. Production deployment was
verified initially on July 17, 2026; the compact dashboard and exact-time release was
deployed and verified on July 19, 2026; and the mobile, scheduling, TV, and demo update
was deployed and live-verified on July 20, 2026. The same day's Hosting-only layout
refinement was also deployed and live-verified.

## Applied visual redesign

An isolated, interactive redesign preview was added on July 17, 2026 and approved
for production. The live application now uses
the **Quiet Study** member/Admin visual system, the **Signal Timetable** lobby TV,
and an availability-first phone scheduler. The prototype remains as the design
reference and continues to use sample information only.

- [Open the interactive prototype](design-prototype.html)
- [Read the design research and decisions](DESIGN-RESEARCH.md)

The scheduling, security, privacy, and approval rules documented below remain the
source of truth.

On July 19, 2026, the same approved direction was refined into a more compact
dashboard-and-disclosure flow. Home now opens first with current/upcoming unit use and
a bounded live feed. Reservations uses a single-date arrow stepper and three daypart
disclosures. On July 20, the compact two-column start grid was replaced with a vertical
phone list that opens an immediate **When should it end?** prompt after a start is
chosen, while retaining the exact end boundary. The deployed July 20 refinement makes
that list compact connected time/availability rows, starts Home with a three-daypart Day
overview, and narrows the lobby display to study-room availability.

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
through the end of the day when it is one of those weekdays. A compact left/right
stepper moves between the dates, and the selected date is shared across Reservations
and Admin. Reservations is the only member booking screen; there is no separate Sign
up tab.

### Time range and services

All reservable slots are 30 minutes. Booking begins at 10:00 AM and the final slot is
10:30–11:00 PM. The member and TV views must therefore include 10:00 PM and 10:30 PM
start positions, while server validation rejects any end after 11:00 PM.

Unavailable service periods are:

- Tuesday: 8:00–9:00 PM.
- Saturday: 9:00–10:00 AM, 3:00–4:00 PM, and 8:00–9:00 PM.

Saturday’s visual schedule starts at 9:00 AM to show the morning service. Validation
must reject ranges that overlap a service or begin before reservable time.

### Member booking flow

The Reservations screen shows one Study room, Whiteboard, or TV at a time. The date
stepper and resource picker sit directly above three native disclosures: Morning,
Afternoon, and Evening. Each disclosure states its available start-time range and
contains compact, visually connected 36px rows for each listed start time. The time
action starts a reservation; the separate attached availability action opens details
without starting one. Tapping a start opens one **When should it end?** choice. The
chosen ending is stored exactly;
selecting 10:00 AM then 11:30 AM means 10:00–11:30 AM. After a complete range, the
screen shows an open/pending button. Its detail lists approved occupants by numbered
unit and every overlapping pending request separately. Pending requests never occupy a
numbered unit before approval. The short sheet then asks only for name and purpose
(Contact, New Member, Meeting, or Other).

Service periods divide the daypart options but do not appear as selectable member
times. They cannot be selected or crossed. The lobby timetable continues to show the
service bands explicitly. The same interaction works on phone and desktop layouts.

Home’s Day overview mirrors the member-safe part of the Admin day map and is the first
Home feature. It separates the schedule into expandable Morning, Afternoon, and Evening
sections, each with the applicable service band and half-hour grid. Its open slots are
buttons that set the selected date, resource, and start time in Reservations, then focus
the end-time choice; full and service slots are not booking actions. The former
device-specific notification and current/next-summary cards are not part of this
refinement; the bounded live activity feed follows the overview.

If no numbered unit is free for the complete selected range, the member interface
uses an inline alert with the exact unavailable message. It computes the longest
continuous shorter ending from the same start and offers Yes/No recovery when one
exists. The protected submission transaction repeats the whole-range capacity check
for both Tuesday and Saturday, preventing a stale browser from saving an impossible
request.

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
first free unit and approves the request in one transaction. The same happens for a
Saturday request made on its booking Saturday at or after 10:00 AM Los Angeles time.
Advance Saturday requests stay pending even after Saturday begins, so the Admin queue
and assignment recommendations sort them by Contact, New Member, Meeting, Other, then
request time. The approval predicate is a pure policy helper and must use
`America/Los_Angeles`, never the server host time zone.

The activity feed derives Requested, Reserved, and Cancelled events from booking
timestamps. Approved cancellations retain their last assigned unit in server-only
write data so the feed can accurately say which room, whiteboard, or TV was cancelled.
`?demo=1` overlays complete sample records in the browser only; it never writes them to
Firestore. The planned member and TV previews include both eligible dates, all resource
types, assigned bookings, overlapping pending requests, a full range, a declined item,
a cancellation, and visible service periods.

Home is the opening screen. It shows Study Rooms by default and lets a member switch to
Whiteboards or TVs. The overview's daypart grid shows approved use and open cells; the
live update feed is capped in the DOM and scrolls inside a fixed-height region so ongoing
activity does not lengthen the page.

Approval performs a fresh conflict check, records the chosen assignment, and moves the
booking from the pending lane into the assigned row. Decline or cancellation removes
it from the active schedule. The UI reports saving, saved, failed, reconnecting, and
live states based on the actual result rather than assuming a write succeeded.

## Privacy and security model

### Members

Members do not create accounts or see a login screen. Firebase silently creates an
anonymous identity. New bookings store that owner identity along with update and
schema information. Direct client creation is blocked; the protected callable function
creates valid instant or pending bookings for the two allowed dates. Database rules let
members cancel only their own eligible requests.

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

The TV renderer has a day setting limited to eligible Tuesday/Saturday dates:

- Four prominent study-room availability cards, plus a supporting approved-reservations-
  only study-room timeline through 11:00 PM with service blocks, clock, and connection
  status.
- A current-time marker only when the selected day is today.

Public names are reduced to first name plus last initial. Pending requests, Whiteboard
lanes, and TV lanes are intentionally excluded from the lobby display. The display keeps
a narrow cache of only the information it needs. When Firestore disconnects, it
preserves the last schedule and shows **Reconnecting** and the last update time. The CSS
has layouts for 1920×1080 and 1280×720 lobby screens, and preserves a horizontal
timetable rather than compressing labels at narrow widths.

## Phone and accessibility design

The phone layout uses a compact single-date arrow stepper and native time selects
inside three disclosures. It opens the same short booking pop-up as the desktop view.
Main controls use at least 44×44-pixel touch targets.

Tabs and selected controls expose their state to assistive technology. Inputs have
real labels, status and error messages are announced, the masthead home behavior is
keyboard accessible, contrast remains readable, and layouts tolerate enlarged system
text and reduced motion.

## Testing expectations

Production verification covers:

- Upcoming-date calculation, including when today is Tuesday or Saturday.
- Every service block and rejection of crossing ranges.
- The 10:00 PM and 10:30 PM starts, final 10:30–11:00 PM slot, and rejection after
  11:00 PM.
- Tuesday instant approval; advance Saturday pending; and the Los Angeles 9:59 AM /
  10:00 AM Saturday boundary.
- Four-room capacity and removal of every future Baptism Room path.
- Pending-to-approved, decline, cancel, reconnect, and failed-save transitions.
- Member ownership and rejection of unauthorized Admin or cross-member changes.
- Two simultaneous devices receiving live changes without refresh.
- Selecting 10:00 AM as Start and 11:30 AM as End produces exactly 10:00–11:30 AM
  on desktop and phone.
- A range with no whole-range unit shows the unavailable alert and shorter-ending
  recovery; the backend independently refuses the stale/conflicting submission.
- A member can choose a range only within the same non-service period.
- Home’s open-slot handoff to Reservations, expandable Morning/Afternoon/Evening
  overview, named assignment/pending detail button, compact connected mobile start
  rows, and immediate end-time prompt.
- The calendar has no separate Sign up tab or "reservations unavailable" notice.
- Phones at 320, 375, and 390 pixels.
- TV mode at narrow width, 1280×720, and 1920×1080, including its eligible-day selector,
  four room cards, approved-only study-room timeline, and demo data.
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
