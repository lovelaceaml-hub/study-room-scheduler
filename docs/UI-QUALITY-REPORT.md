# Study Rooms UI quality report — July 17, 2026

## July 19 compact-dashboard verification

The Home dashboard, date stepper, explicit Start/End menus, compact open/pending
summary, numbered-unit disclosure, and unavailable-range recovery were driven in a
real headless Chromium browser at 390×844 and 1280×900. The sample conflict used three
rooms occupied from 11:00–11:30 AM plus one room occupied from 10:00 AM onward.
Selecting 10:00 AM then 11:30 AM produced the required unavailable message and offered
10:00–11:00 AM instead; Yes produced exactly that range and the confirmation sheet
repeated it. Home rendered all four rooms and the bounded live feed, and the date arrows
moved between Tuesday and Saturday. The browser reported no page errors.

After the protected function and `app` Hosting target were deployed on July 19, the
same critical journey passed against **https://lvrooms.web.app/?demo=1** in a fresh
browser context. The live **https://lvrooms.web.app/?tv=1** route also rendered its
real-time timetable surface successfully. Demo verification made no booking writes.

Phone and desktop screenshots were visually reviewed for hierarchy, overflow, fixed
navigation, disclosure state, readable labels, and touch-target size. JavaScript syntax,
policy tests, diff checks, narrow-screen overflow, keyboard focus, and the independent
review evidence are recorded in the current release handoff.

This report retains the original July 17 redesign evidence and adds the July 19
dashboard, interaction, accessibility, and protected-capacity checks above.

## Surfaces reviewed

- Member Reservations using Quiet Study and availability-first time rows.
- My reservations using durable upcoming and previous-decision cards.
- Admin at locked-phone and unlocked-desktop sizes.
- Lobby TV using the Signal Timetable presentation.
- Light and dark system themes.

## Browser evidence

The real application was served locally and driven through its visible controls.

| View | Size | Result |
|---|---:|---|
| Member | 320 × 720 | No document-level sideways scrolling; 48px bottom tabs; keyboard tab navigation and focus passed. |
| Member | 390 × 844 | Date arrows, resource switching, three time disclosures, exact endpoints, expanded units, conflict recovery, and sheet rendered correctly. |
| Member | 1280 wide | Header, tabs, and member content share the same 880px alignment. |
| Admin locked | 390 wide | PIN form reflows without horizontal overflow and preserves typed input across live refreshes. |
| Admin unlocked | 1280 × 900 | Queue/detail grid rendered as two columns; selecting another request updated its detail and recommended assignment. |
| Lobby TV | 1280 × 720 | Signal header, live state, closed-day message, and legend were distance-readable with no overflow. |

The TV was tested on a Friday, so **No study-room schedule today** was the correct
live state. Code review separately verified that Tuesday/Saturday use all 12 unit
rows, full-day positioning through 10:00 PM, service bands, pending lanes, and the
track-relative current-time marker.

## Interaction and state checks

- Start and End selects use exact boundaries; 10:00 AM plus 11:30 AM means
  10:00–11:30 AM with no hidden extra half-hour.
- Whole-range capacity is calculated from a unit that remains open throughout the
  complete range, not independent half-hour counts.
- Clear removed the selection; Continue opened the correct sheet and restored focus
  when closed.
- Saturday showed **Request this time / Send request**; Tuesday showed
  **Reserve this time / Reserve now**.
- Name and Other-purpose validation remained required.
- Demo mode hid Admin, used only fixed sample data, skipped Firebase startup, and
  displayed a clear no-save message on submission.
- Pending demand appeared only as an aggregate request count and never occupied a
  numbered unit before approval.
- Admin queue selection changed the detail and assignment context without changing
  data. Approve/decline/direct-add controls have duplicate-submit guards.
- Empty/loading, pending, approved, declined, cancelled, reconnecting, error, and
  closed-day presentations are all explicitly represented.

## Keyboard and accessibility checks

- Tabs expose correct tab roles, selected state, roving tab stops, selected-panel
  labels, and arrow-key navigation without swipe gestures.
- Time selects preserve keyboard focus after rerender and the completed range is
  announced through a polite status region.
- The booking sheet traps Tab, supports Escape, makes background controls inert,
  and restores focus to Continue when closed.
- Admin text fields and the PIN retain value, caret, and focus during live-data
  rerenders; session expiry automatically clears private notes and relocks the UI.
- Visible focus uses a high-contrast light-and-dark double ring, including on
  primary-colored cards. Small muted text and featured-card accents meet the
  reviewed contrast thresholds.
- Status is communicated with text and shape/pattern, not color alone.
- Member/Admin controls meet the 44px target, and mobile inputs use at least 16px
  text to avoid iPhone auto-zoom.
- Extremely narrow/enlarged-text layouts stack resource controls, selection actions,
  purpose controls, and sheet actions rather than clipping.
- User-provided long strings use safe wrapping, and banner messages use text-only
  rendering to prevent stored HTML execution.

## Automated checks

- `node --check` passed for `app.js`, `tv.js`, and `sw.js`.
- All 12 scheduling-policy tests passed, including the full Saturday range and
  shorter-ending calculation.
- The Playwright critical journey and two automated axe scans passed with zero
  violations on the tested Home and reservation-confirmation states.
- `git diff --check` passed.
- Firestore rules were not changed. Their emulator suite could not start because
  this Mac does not currently have the Java runtime required by Firebase Emulator.

## Independent review

Three separate reviewers challenged the implementation for scheduling accuracy,
mobile/accessibility behavior, Admin security/privacy, and lobby-TV fidelity. Their
material findings were corrected before deployment, including safe demo isolation,
Admin session expiry, duplicate-action guards, TV cache privacy and midnight
rollover, accurate 10:00 PM day boundaries, focus restoration, contrast, and PWA
palette consistency.
