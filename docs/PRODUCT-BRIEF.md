# LV Zion Study Rooms — Product Brief

## Product

- **Name:** LV Zion Study Rooms
- **Audience:** LV Zion members reserving study rooms and shared equipment, approvers, and people viewing the lobby TV.
- **Problem it solves:** Makes it quick to see what is open, reserve an exact time range, and understand live room use without relying on a spreadsheet relay.
- **First successful moment:** A member succeeds when they can see an open time, tap it, answer **When should it end?**, and send a valid reservation without wondering what the selected times mean.

## Main tasks

1. Check two recent schedule updates, then see current room activity in a member-safe Home day overview.
2. Reserve a study room, whiteboard, or TV for an exact available range.
3. Review assignments and pending requests, then assign, approve, decline, or cancel reservations when needed.
4. Choose the day shown on the lobby TV and inspect a full mock schedule safely.

## Constraints

- **Devices / context of use:** Phones are primary for members; desktop supports approvers; a 1280×720 or 1920×1080 screen shows the lobby timetable.
- **Accessibility needs:** Keyboard operation, visible focus, text labels, status announcements, 44-pixel touch targets, and layouts that reflow at enlarged text.
- **Brand or content constraints:** Professional and minimal church presentation; no cross/church imagery and no emoji.
- **Privacy / permissions considerations:** Public views show scheduling information only; private notes and Admin controls remain protected.

## Risks and exclusions

- **Likely confusion or failure points:** Mistaking a clicked time for a hidden extra 30 minutes, selecting a range that has no single unit open throughout, unclear Saturday instant/pending status, and scanning too many half-hour rows.
- **Out of scope for this version:** New resource types, additional reservable weekdays, or changes to the existing Admin authentication model.
- **What must not change:** Tuesday/Saturday eligibility, 30-minute boundaries, service-time blocking, numbered-unit capacity, booking privacy, or lobby-TV service bands. The current approval policy is Tuesday instant; Saturday instant only for a submission made on that Saturday at or after 10:00 AM Los Angeles time; advance Saturday requests remain pending.

## July 20 release scope

The July 20, 2026 release was deployed and live-verified. It extends closing to 11:00
PM, including 10:00 PM and 10:30 PM starts. It makes member start times vertical on
phones, uses an immediate end-time prompt, puts the Admin-style day overview on Home
for every member, and makes the open/pending count a detail button for named assignments
and unassigned pending requests. It also adds an eligible-day setting and full
browser-only mock data to the lobby TV.

## Pending Home-first refinement

The current branch makes Home the sole member booking surface at every width. It puts
two compact Live updates before the overview; uses a one-date arrow stepper; shows the
public booking purpose beneath each occupied member/Admin map cell; and gives each
daypart an explicit vertical-scroll cue. An open Home cell follows the complete
start-to-end-to-availability-to-Continue path without a Reservations tab. My
reservations, Admin, all approval policy, privacy boundaries, and the TV are unchanged.
This refinement awaits verification and deployment.
