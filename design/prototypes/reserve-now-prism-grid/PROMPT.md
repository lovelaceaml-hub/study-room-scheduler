# Corrected Build Prompt — LV Rooms

Create a **completely new mobile-first prototype** for the LV Rooms app. Do not simply reskin or slightly rearrange the current design. The visual concept, page composition, motion language, depth, and interaction treatment should feel like a genuinely new product direction while still following the functional requirements below.

The app should be simpler to understand and higher quality to use. It must have one highly prominent **Reserve Now** button that remains visible on screen at all times, even while scrolling.

When the user taps **Reserve Now**, open a guided reservation flow:

1. Ask what they want to reserve:
   - Room
   - Whiteboard
   - TV

2. If **Room** is selected, ask: **What is the room for?**
   - Contact — 1st priority
   - New Member — 2nd priority
   - Other — last priority, with a required text input describing the purpose

3. Ask: **When would you like to start?**
   - Show only actual start times that still have availability for the selected resource type.

4. After a start time is chosen, ask: **When would you like to end?**
   - Show only valid end times that are truly available after the selected start time.

5. Show a final confirmation screen with the resource, date, purpose, start time, end time, and user name, then a single **Confirm Reservation** button.

## Full-Day Schedule — This Is a Critical Requirement

Below the primary reservation area, show the **entire day's schedule**. Do not use summary cards, mini timelines, isolated room cards, a partial time sample, or a condensed availability overview as the main schedule.

The schedule must be a true **vertical calendar grid**:

- Time runs vertically down the left side.
- Each room is a vertical column next to the others.
- For Rooms, the structure should read:

  **Time | Room 1 | Room 2 | Room 3 | Room 4**

- Show the full reservable day, not only a few hours.
- Use 30-minute time slots.
- Every time slot for every room must be represented visually.
- A user should be able to look at any time and immediately compare all four rooms side by side.

Each block must clearly show its state:

- **Available**
- or, when reserved:
  - reservation holder's name
  - **Contact**, **New Member**, or **Other**
  - optional short description for Other
- service or otherwise unavailable periods should be clearly shown as unavailable

Reservations lasting multiple time slots should visually span the actual duration as one continuous block rather than being shown as repeated disconnected entries.

Keep the room/resource headers visible while scrolling vertically where practical. On mobile, allow horizontal scrolling if necessary, but keep the time column visible so the user always knows which time they are looking at.

## Schedule Toggles

Provide three clear toggles above the calendar:

- Rooms
- TVs
- Whiteboards

Switching the toggle changes the calendar columns, but the same full-day vertical calendar concept remains. TVs and Whiteboards should show all of their individual resources side by side just like Rooms.

## Visual Direction

Make this prototype visually **nothing like the current design or prior prototypes**.

Use an advanced, eye-catching, premium visual system with:

- glossy and shiny materials
- dimensional 3D architecture
- floating translucent surfaces
- beveled or polished edges
- rich depth and layered lighting
- luminous accent colors
- subtle animated reflections
- controlled glow
- fluid transitions
- tactile buttons with visible depth
- elegant motion when changing views or opening the reservation flow

The interface should feel like a next-generation architectural/spatial control system rather than a normal dashboard.

Use color intentionally to distinguish states:

- Contact
- New Member
- Other
- Available
- Service / unavailable

The schedule's readability is more important than decoration. 3D effects, reflections, gradients, animation, and glow must never make the person's name, purpose, time, or availability difficult to read.

## Mobile-First Requirement

Design primarily for phones. The app must remain easy to use at approximately 320–430px widths. Keep tap targets comfortable, respect safe areas, and ensure the fixed **Reserve Now** control never covers important schedule content.