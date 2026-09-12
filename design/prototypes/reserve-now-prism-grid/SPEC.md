# LV Rooms — Prism Grid Prototype Specification

## Core goal
Create a completely new mobile-first LV Rooms reservation experience that is simpler to use but visually advanced: glossy, shiny, architectural, dimensional, colorful, animated, and unlike the existing prototypes.

## Persistent primary action
A prominent **Reserve Now** button must remain visible at all times while the user scrolls.

Tapping **Reserve Now** opens a guided reservation flow:

1. **What would you like to reserve?**
   - Room
   - Whiteboard
   - TV

2. **If Room is selected: What is the room for?**
   - Contact — 1st priority
   - New Member — 2nd priority
   - Other — last priority, with required text input

3. **When would you like to start?**
   - Show only actual start times that still have availability for the selected resource type.

4. **When would you like to end?**
   - Show only valid end times based on the selected start time and real remaining availability.

5. **Confirm reservation**
   - Show resource, date, start/end time, purpose, and name.
   - One final confirmation action completes the flow.

## Schedule — critical requirement
The schedule must **not** be a summary, mini timeline, card list, or partial sample.

It must show the **entire day's schedule** in a vertical calendar grid.

- Time runs vertically down the left side.
- Resources are vertical columns side by side.
- For Rooms, the structure is exactly conceptually:

  `Time | Room 1 | Room 2 | Room 3 | Room 4`

- Every time slot for every room must appear.
- Use 30-minute time slots across the full reservable day.
- A slot must clearly show one of:
  - **Available**
  - reservation holder's name + **Contact**
  - reservation holder's name + **New Member**
  - reservation holder's name + **Other** (and optional short description)
  - service/unavailable block when applicable
- Multi-slot reservations should visually span their actual duration instead of appearing as unrelated duplicate reservations.
- Keep the resource header visible while scrolling vertically where practical.
- Keep the time column visible when horizontally scrolling on narrow mobile screens.

## Schedule toggles
Above the calendar, provide three simple toggles:
- Rooms
- TVs
- Whiteboards

The same full-day vertical calendar concept applies to each resource type. The column count changes to match the actual resources.

## Visual direction
Do something completely different from prior LV Rooms concepts.

Direction: **Prism Architecture**

- dark dimensional architectural canvas
- glossy transparent slabs / floating glass planes
- polished 3D edges and beveled surfaces
- luminous accent lighting
- strong depth hierarchy
- animated ambient reflections and soft moving light
- colorful but controlled
- premium, modern, eye-catching
- tactile buttons with realistic depth
- fluid sheet transitions
- subtle parallax / shimmer / glow

The design should feel like a next-generation spatial control interface, not a standard dashboard.

## Usability priorities
1. Reserve Now must always be obvious.
2. The full-day schedule must be readable before decorative effects.
3. Purpose colors must be instantly distinguishable.
4. The user must always know which resource type and day they are viewing.
5. Mobile-first interaction targets must remain easy to tap.
6. Decorative 3D effects must never obscure reservation names, times, or availability.