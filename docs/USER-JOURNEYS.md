# LV Zion Study Rooms — User Journeys

## Journey: Check what is happening now

- **User:** Member arriving on Tuesday or Saturday.
- **Starting situation:** Opens the app without needing to create a reservation yet.
- **Goal:** See two recent updates, then current room use and open booking opportunities.
- **Success is observable when:** Home shows two compact live updates followed by a member-safe day overview; Study room is the default and Whiteboard or TV can be chosen.
- **Steps the product must make clear:**
  1. Open Home.
  2. Read the two most recent updates and use Home's one-date arrows if another
     eligible day is needed.
  3. Choose Whiteboard or TV only when that detail is wanted.
  4. Expand a daypart, follow its scroll cue when needed, and tap an open time.
- **Empty / loading / error / success behavior:** Connecting is explicit; an empty feed says there are no updates; an unused unit says Open; connection errors preserve the last safe view.
- **Recovery or Undo:** The member can return Home by tapping the header or Home tab.
- **Phone-specific consideration:** The feed remains two rows; daypart maps give a clear
  vertical-scroll cue and unit rows remain compact.
- **Keyboard / assistive-technology consideration:** Resource choices expose pressed state; open-slot buttons describe their time and availability; the assignment/pending detail button has an explicit expanded state.

## Journey: Reserve an exact available range

- **User:** Member arranging a study.
- **Starting situation:** Opens Home on a phone or desktop.
- **Goal:** Reserve an available resource from an exact start time to an exact end time.
- **Success is observable when:** The confirmation repeats the exact selected range and the saved reservation uses those endpoints with no hidden extra half hour.
- **Steps the product must make clear:**
  1. Use Home's arrows to choose the upcoming Tuesday or Saturday.
  2. Choose Study room, Whiteboard, or TV.
  3. Open Morning, Afternoon, or Evening, use its scroll cue where needed, and tap an
     open cell.
  4. Answer **When should it end?** with the exact end time, inspect availability, then
     continue.
  5. Enter a name and purpose and submit.
- **Empty / loading / error / success behavior:** Availability waits for verified live data; full times are labeled; a valid range displays open capacity; success states whether the reservation is approved or pending.
- **Recovery or Undo:** If the range becomes unavailable, an alert explains that no unit is open and offers the longest available shorter ending when one exists, with Yes and No actions.
- **Phone-specific consideration:** Home is the same booking surface on every width;
  Morning, Afternoon, and Evening can remain independently expanded as needed.
- **Keyboard / assistive-technology consideration:** Native disclosure controls and buttons support keyboard use; status changes are announced.

## Journey: Review and display the day

- **User:** Approver or lobby viewer.
- **Starting situation:** An approver has an advance Saturday request or the lobby TV is open.
- **Goal:** Keep assignments conflict-free and make room/service timing legible.
- **Success is observable when:** Admin sees exact start/end ranges and unit availability; the TV shows approved Study Room assignments and service bands for a chosen eligible Tuesday or Saturday.
- **Steps the product must make clear:**
  1. Unlock Admin or open TV mode.
  2. Review the selected date and resource, or select the TV day to display.
  3. Assign and approve safely, or read the live timetable.
- **Empty / loading / error / success behavior:** Clear queue, no eligible TV day, reconnecting, conflict, and saved states are explicit. Tuesday is instant; Saturday becomes instant only for a submission made on that Saturday at or after 10:00 AM Los Angeles time.
- **Recovery or Undo:** Admin can decline/cancel or choose another free numbered unit; the TV retries without discarding its last safe cache.
- **Phone-specific consideration:** Admin tools stack on narrow screens.
- **Keyboard / assistive-technology consideration:** Admin controls retain visible focus and the TV includes text labels for service and status.
