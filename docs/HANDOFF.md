# Handoff notes — LV Zion Study Rooms

## Current status

**Live.** The secure backend, redesigned app, lobby TV, and shorter address were
deployed and verified on July 17, 2026.

- **Primary address:** https://lvrooms.web.app
- **Lobby TV:** https://lvrooms.web.app/?tv=1
- **Previous address:** https://lvz-rooms.web.app — retained as a redirect
- **Firebase project:** `lvz-rooms`
- **GitHub repository:** `lovelaceaml-hub/study-room-scheduler` (private)

## Approved implementation

- Show only the upcoming Tuesday and upcoming Saturday, including today when
  applicable, in chronological order.
- Use 30-minute booking slots through 10:00 PM.
- Block Tuesday 8:00–9:00 PM and Saturday 9:00–10:00 AM, 3:00–4:00 PM, and
  8:00–9:00 PM for services.
- Show Saturday from 9:00 AM so the morning service is visible; booking still begins
  at 10:00 AM.
- Open on Home with current/upcoming numbered-unit use and a bounded, scrollable live
  update feed. Study Rooms are the default; Whiteboard and TV schedules are optional.
- Make Reservations the only member booking screen: members step between the two
  eligible dates, open Morning/Afternoon/Evening, choose exact Start and End values,
  then complete the remaining details in a pop-up.
- Store the second selected time as the exact ending; never silently add another
  30 minutes. Keep member options divided around service periods while the TV retains
  visible service bands.
- Show only open and pending counts for a complete range. Put numbered-unit occupants
  behind a secondary disclosure.
- Refuse a range that has no one unit open throughout. Offer the longest continuous
  shorter ending with Yes/No actions when possible, and repeat the check in the
  protected backend transaction for both Tuesday and Saturday.
- Show every pending request live in amber resource-type lanes before approval.
- Move approved requests into Study Room 1–4, Whiteboard 1–5, or TV 1–3 rows.
- Remove the Baptism Room from future scheduling and return active future assignments
  there to pending for reassignment.
- Add the read-only current-day lobby TV presentation with first name plus last
  initial, current time, live status, and cached reconnect behavior.
- Improve the phone layout with a compact tappable calendar, larger touch targets,
  clearer selected states, pop-up labels and announcements, keyboard access, and
  enlarged-text support.
- Use silent member identity for ownership and protected backend Admin actions while
  keeping the familiar `0000` PIN experience.
- Keep optional notes Admin-only and never expose them on public or TV schedules.
- Member reservations now use one resource type at a time (Study room, Whiteboard, or
  TV), a compact scrollable calendar, and a name-and-purpose-only confirmation sheet.
- The visual redesign uses shared, accessible light/dark design tokens across the
  member app and lobby TV. It preserves every scheduling and security behavior.
- Home now opens first. The Study room, Whiteboard, and TV picker switches the one
  visible resource schedule; Reservations uses a single-date arrow stepper. Live
  updates are on Home, while My reservations focuses on this device’s requests.
  The header has no connection-status label, and left/right tab swiping is disabled.
- Tuesday reservations auto-approve securely; Saturday remains manual with the Admin
  queue and assignment recommendation ordered Contact, New Member, Study Member
  Meeting, Other, then request time.
- The approved Quiet Study production design leads with availability counts on
  member screens, keeps numbered-unit occupancy expandable and secondary, presents
  My reservations as durable status cards, and expands Admin into a desktop
  queue-and-detail workspace.
- The lobby TV uses the approved Signal Timetable treatment with all 12 units,
  full-day positioning, pending request lanes, service bands, and a track-relative
  current-time marker.

## Important behavior

Pending requests reserve no specific unit. Their amber position means only that a
member asked for that resource type and time. Approval performs the assignment and a
fresh conflict check. Failed writes must visibly fail and roll back instead of looking
saved. New pending requests are accepted only when at least one numbered unit is still
open for the entire requested range at submission time.

The TV shows today only. On a day other than Tuesday or Saturday, **No study-room
schedule today** is correct. It uses `?tv=1`, omits all Admin controls and private
details, and preserves its last public schedule during a connection interruption.

## Rollout checklist

- Firebase Blaze billing is enabled on this project through the church's existing
  Firebase Payment account because protected functions require it.
- Confirm future Baptism Room bookings were safely returned to pending.
- Verify anonymous request creation and owner-only cancellation.
- Verify Admin unlock, approve, decline, cancel, reassignment, direct-add, and lock.
- Verify exact Start/End selection, Morning/Afternoon/Evening disclosures, date arrows,
  unavailable-range recovery, and the booking pop-up on desktop and phone.
- Verify simultaneous member, Admin, phone, and TV live updates.
- Verify 320/375/390-pixel phone views and 720p/1080p TV views.
- Verify the shared visual tokens load in both the member app and lobby TV after an
  installed copy updates.
- Verify the primary URL, previous-address redirect, and preservation of `?tv=1`.
- Verify installation and offline/reconnect behavior from the new hostname.
- Keep this file and the Quick links status current after future releases.

## Maintenance notes

The app is intentionally buildless. Keep scheduling rules centralized so member,
Admin, validation, and TV behavior cannot drift. Keep deployments scoped, preserve
the old hostname redirect, and seek Anthony’s approval before changing billing.
