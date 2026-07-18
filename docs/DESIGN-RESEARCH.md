# Study Rooms design research — July 2026

This document records the research and decisions behind the proposed Study Rooms
visual redesign. The live app has not been changed. Open the
[interactive prototype](design-prototype.html) to review the proposed experience.

## Chosen direction

- **Member and Admin:** Quiet Study — warm ivory surfaces, deep pine controls,
  restrained brass accents, editorial headings, and modern system text.
- **Lobby TV:** Signal Timetable — high-contrast resource labels, a fixed time scale,
  explicit service and request patterns, and a precise current-time marker.
- **Phone scheduling:** availability first. Members choose a useful time from large
  rows that say how many resources remain open. Exact numbered-unit occupancy is
  secondary detail because Admin assigns the final unit.

The prototype uses sample information only and never connects to Firebase.

## Independent design review

Three separate reviewers examined the live experience and then challenged the
prototype from different angles: scheduling accuracy, mobile interaction and
accessibility, and visual-system consistency. Their review directly led to the
availability-first approach and also caught issues before this preview was shared:

- resource and date controls now update the sample inventory instead of changing
  labels only;
- a selected range reports units open for the entire range and includes Clear;
- the request sheet validates the member name and an Other-purpose description;
- dark mode, keyboard focus, Escape-to-close, and reduced motion are represented;
- Admin approval updates its counts, queue, assigned unit, and day map together;
- the TV now shows all 12 units, a request lane, and the complete 9:00 AM–10:00 PM
  scale with continuous booking blocks.

## What the review found

The live app is reliable and understandable, but the phone calendar behaves like a
desktop allocation spreadsheet compressed into a narrow screen. Names become very
small, long bookings fragment across many rows, and the layout can suggest that a
member is choosing a numbered room even though the approver makes that assignment.

The desktop app is also capped at 760 pixels, leaving a large amount of unused space.
Admin therefore appears as one long stack instead of an approval workspace. The
mobile Schedule updates table is wider than a phone and requires horizontal scrolling.

The redesign addresses these structural problems before adding decoration:

1. Availability is the main member decision.
2. Unit-level scheduling remains available to Admin and the lobby TV.
3. My reservations uses durable status cards instead of a wide table.
4. Admin becomes a queue-and-context desktop workspace.
5. The TV becomes a distance-readable timetable rather than a card dashboard.

## Scheduling truths the design must preserve

- Upcoming Tuesday and Saturday only; today counts when applicable.
- Tuesday reservations confirm immediately when space remains open.
- Saturday requests require approval.
- Study Rooms 1–4, Whiteboards 1–5 with matching podium included, and TVs 1–3.
- No Baptism Room, separate podium request, preferred room, or member certainty field.
- Thirty-minute periods through 9:30–10:00 PM.
- Saturday services at 9:00–10:00 AM, 3:00–4:00 PM, and 8:00–9:00 PM.
- Tuesday service at 8:00–9:00 PM.
- Pending requests do not own numbered units before approval.
- The lobby TV uses first name plus last initial and never shows private notes,
  purposes, preferences, PIN controls, or Admin actions.

## Research principles applied

- Show the smallest calendar view that supports the task instead of shrinking a
  desktop calendar onto a phone. Notion Calendar similarly limits its mobile views
  to a small number of days: [Notion Calendar mobile apps](https://www.notion.com/help/notion-calendar-apps).
- Keep contextual completion details in a short sheet after the time is selected:
  [Apple sheet guidance](https://developer.apple.com/design/human-interface-guidelines/sheets).
- Put durable approval or pending feedback beside the reservation it describes:
  [Apple feedback guidance](https://developer.apple.com/design/human-interface-guidelines/feedback).
- Use status words and shapes or patterns in addition to color:
  [W3C use of color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color).
- Use at least 44-point/48-dp effective mobile targets:
  [Apple design tips](https://developer.apple.com/design/tips/) and
  [Android accessibility guidance](https://developer.android.com/guide/topics/ui/accessibility/views/apps-views).
- Respect reduced motion, readable typography, and adaptable hierarchy:
  [Apple motion](https://developer.apple.com/design/human-interface-guidelines/motion) and
  [Apple typography](https://developer.apple.com/design/human-interface-guidelines/typography).
- Meet WCAG 2.2 target-size, visible-focus, and focus-not-obscured expectations:
  [W3C WCAG 2.2 changes](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/).
- Keep bottom actions clear of phone home indicators and gesture regions:
  [MDN safe-area guidance](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Environment_variables/Using).

## Prototype review checklist

Before the design is applied to production, confirm:

- A member can select 11:00 AM, extend through 12:00 PM, open the request sheet,
  and reach My reservations without confusion.
- Saturday says **Send request** and explains approval; Tuesday says **Reserve now**
  and explains immediate confirmation while space remains open.
- Full periods stay visible but cannot be selected.
- Pending demand never appears inside a numbered room cell.
- The member experience has no document-level horizontal scrolling at 320, 375,
  or 390 pixels.
- Admin shows queue priority, recommended assignment, occupied units, conflicts,
  approval, decline, and a useful day map at desktop width.
- The lobby TV remains readable at 1280×720 and 1920×1080.
- Status remains understandable in light mode, dark mode, enlarged text, and without
  relying on color alone.

## Deliberately not changed yet

The prototype does not alter production HTML, CSS, JavaScript, Firebase data,
security rules, Cloud Functions, scheduling policy, or deployment. Implementation
begins only after Anthony accepts the accurate prototype.
