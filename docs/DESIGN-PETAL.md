# Petal

Petal turns the schedule into an intimate rose-and-oat invitation card. A compact rounded serif greeting sits beside two tactile date tickets on desktop and above them on mobile. One soft white card holds the resource tiles, the entire day, and its attached sticky reservation action.

## Signature

Debossed open paper tiles invite a tap. Occupied blocks use muted rose, sage, and oat with inset purpose tags. Numbered units stay side by side with one boundary-aligned time rail. Day changes unfold with a short stagger across the columns, with motion removed when reduced motion is requested.

## Distinction

The desktop silhouette stays centered at 780 pixels. Its invitation strip and date tickets make a small personal composition, while mobile brings the schedule card to the edges and visually joins its action bar to the bottom. There is no sidebar, continuous column well, large editorial hero, literal flower illustration, saturated pink, or ornate edge.

## Prototype

- File: `/Users/anthony/Projects/.worktrees/study-room-scheduler-petal/design/prototypes/reserve-now-petal/index.html`
- Standalone HTML, CSS, and JavaScript with system fonts. No network requests or Firebase code.
- Fictional sample names. Bookings exist only in browser memory and clear on refresh.
- Complete 10 AM to 11 PM schedule in half-hour steps, with four study rooms, five whiteboards, and three TVs.
- Upcoming Tuesday and Saturday tickets use the Los Angeles date. Saturday services: 10 AM to 11 AM, 2:30 PM to 3:30 PM, and 7:30 PM to 8:30 PM. Tuesday service: 7:30 PM to 8:30 PM.
- General Reserve Now begins with the resource. An open tile preserves the exact resource, unit, and start and begins with purpose. Endings require a single unit free for the entire interval, stop at conflicts and services, and preserve the exact chosen ending.
- Purpose, optional start selection, ending, fictional name, review, and visible simulated success all work. Saved samples update the schedule, using first name and last initial.
- Native modal dialog, explicit focus containment, Escape, focus restoration, visible focus rings, and minimum 44-pixel interactive targets.
- Preview states: append `?state=loading`, `?state=empty`, or `?state=error`. Each includes a recovery control. The loading state stays visible until its control is pressed so it is easy to test.

## Handoff

Implementation delivered to the controller for the requested quick smoke and isolated preview deployment. No production files, configuration, backend policy, reference prototypes, commits, or deployments were changed by this design lane. Production priority override is outside this fictional interaction prototype.
