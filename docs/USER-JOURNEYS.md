# LV Zion Study Rooms — User Journeys

## Journey: Check what is happening now

- **User:** Member arriving on Tuesday or Saturday.
- **Starting situation:** Opens the app without needing to create a reservation yet.
- **Goal:** See current and next room use plus recent updates.
- **Success is observable when:** Home shows a live, scrollable update feed and a unit-by-unit current/upcoming schedule; Study room is the default and Whiteboard or TV can be chosen.
- **Steps the product must make clear:**
  1. Open Home.
  2. Read current/upcoming Study room use.
  3. Choose Whiteboard or TV only when that detail is wanted.
- **Empty / loading / error / success behavior:** Connecting is explicit; an empty feed says there are no updates; an unused unit says Open; connection errors preserve the last safe view.
- **Recovery or Undo:** The member can return Home by tapping the header or Home tab.
- **Phone-specific consideration:** The feed scrolls inside a bounded box and unit rows remain compact.
- **Keyboard / assistive-technology consideration:** Resource choices expose pressed state and schedule details are plain text.

## Journey: Reserve an exact available range

- **User:** Member arranging a study.
- **Starting situation:** Opens Reservations on a phone.
- **Goal:** Reserve an available resource from an exact start time to an exact end time.
- **Success is observable when:** The confirmation repeats the exact selected range and the saved reservation uses those endpoints with no hidden extra half hour.
- **Steps the product must make clear:**
  1. Use the arrows to choose the upcoming Tuesday or Saturday.
  2. Choose Study room, Whiteboard, or TV.
  3. Open Morning, Afternoon, or Evening and choose a start.
  4. Choose the exact end time, then continue.
  5. Enter a name and purpose and submit.
- **Empty / loading / error / success behavior:** Availability waits for verified live data; full times are labeled; a valid range displays open capacity; success states whether the reservation is approved or pending.
- **Recovery or Undo:** If the range becomes unavailable, an alert explains that no unit is open and offers the longest available shorter ending when one exists, with Yes and No actions.
- **Phone-specific consideration:** Only one time section needs to be open, avoiding a full-day vertical list.
- **Keyboard / assistive-technology consideration:** Native disclosure controls and buttons support keyboard use; status changes are announced.

## Journey: Review and display the day

- **User:** Approver or lobby viewer.
- **Starting situation:** An approver has pending Saturday requests or the lobby TV is open.
- **Goal:** Keep assignments conflict-free and make room/service timing legible.
- **Success is observable when:** Admin sees exact start/end ranges and unit availability; the TV shows approved/pending use and service bands for the current Tuesday or Saturday.
- **Steps the product must make clear:**
  1. Unlock Admin or open TV mode.
  2. Review the selected date and resource.
  3. Assign and approve safely, or read the live timetable.
- **Empty / loading / error / success behavior:** Clear queue, closed-day, reconnecting, conflict, and saved states are explicit.
- **Recovery or Undo:** Admin can decline/cancel or choose another free numbered unit; the TV retries without discarding its last safe cache.
- **Phone-specific consideration:** Admin tools stack on narrow screens.
- **Keyboard / assistive-technology consideration:** Admin controls retain visible focus and the TV includes text labels for service and status.
