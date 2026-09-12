# Velum

Velum treats reserving a room like opening a gracious note: warm white paper, soft plum ink, editorial serif type, and enough breathing room to feel composed. Its signature is a borderless calendar of softly separated reservation ribbons, with a small purpose dot and the full purpose label.

The full-width masthead frames a centered invitation and a wide calendar. An italic date and delicate underlined resource switches set the hierarchy. On desktop the booking invitation stays in the upper right; on phones Reserve Now becomes a rounded floating pill in the lower right. Date and sheet transitions use a small page-turn fade, with a reduced-motion equivalent.

Anti-goals: heavy tables, colored column wells, dashboard counters, oversized cards, ornamental textures, and status badges. Velum differs from the other directions through stationery material, centered editorial composition, continuous reservation ribbons, understated text switches, and the corner invitation.

## Prototype

- Entry: `/Users/anthony/Projects/.worktrees/study-room-scheduler-velum/design/prototypes/reserve-now-velum/index.html`
- Styles: `/Users/anthony/Projects/.worktrees/study-room-scheduler-velum/design/prototypes/reserve-now-velum/velum.css`
- Interaction: `/Users/anthony/Projects/.worktrees/study-room-scheduler-velum/design/prototypes/reserve-now-velum/velum.js`

The prototype uses fictional sample data and browser memory only. Reloading resets reservations. It contains no network requests, Firebase imports, account integration, or production writes.

## Included interactions

- Upcoming Tuesday and Saturday dates, in Pacific time, with 10 AM through 11 PM schedules.
- Four rooms, five whiteboards, and three TVs; all selected units appear side by side.
- Current service blocks: Saturday 10 to 11 AM, 2:30 to 3:30 PM, 7:30 to 8:30 PM; Tuesday 7:30 to 8:30 PM.
- General Reserve Now starts with resource, then purpose, unit and start, end, fictional name, confirmation, and visible sample success.
- An open cell preserves the precise resource, numbered unit, and start. It begins with purpose and proceeds directly to valid endings.
- Endings stop at the next reservation, service, or closing. Saving validates availability again.
- Native modal dialog with focus restoration, Escape, keyboard controls, and 44-pixel minimum interactive targets at the requested 390-pixel phone width.
- Deliberately held loading, empty, and error states are available with `?state=loading`, `?state=empty`, and `?state=error`. Each has an explicit recovery action.

The parent controller owns browser smoke checks, screenshots, preview deployment, and Git receipts. No review was requested for this design preview. Priority displacement and real booking policy enforcement are outside this browser-only design exercise.
