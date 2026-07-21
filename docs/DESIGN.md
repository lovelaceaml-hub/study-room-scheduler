# LV Zion Study Rooms — Design Direction

## Approved direction

- **Three adjectives:** Quiet, compact, assured.
- **Visual motif:** A concise reservation ledger with disclosure only where detail is requested.
- **Why this supports the audience and first successful moment:** The existing Quiet Study direction remains familiar while the new hierarchy puts live status first and compresses time and numbered-unit details into purposeful disclosures.
- **Reference links or files:** [Approved production prototype](design-prototype.html) and [design research](DESIGN-RESEARCH.md).

## Considered refinements

1. **Ledger Compact — quiet, compact, assured:** single-date stepper, three time disclosures, inline capacity and recovery. Selected because it preserves the approved design while directly reducing vertical scanning.
2. **Timeline Strip — visual, spatial, panoramic:** horizontal day timeline with draggable range. Rejected because it is harder on narrow phones and makes pointer gestures too important.
3. **Guided Wizard — focused, sequential, spacious:** one question per screen. Rejected because it adds navigation and hides useful availability comparisons.

## Hierarchy and content

- **Dominant action on each key screen:** Home shows two live updates and leads through
  an exact booking range to Continue; My reservations leads to status/cancel; Admin leads
  to review and approve.
- **Navigation model:** Home opens first and is the sole member booking surface; My
  reservations and Admin remain peer tabs; tapping the masthead returns Home.
- **Content tone and real-content examples:** Direct language such as “3 open,” “2 pending,” “10:00 AM–11:30 AM,” and “There are no rooms available in the time slot that was selected.”
- **Imagery / illustration purpose:** None; schedule comprehension does not benefit from imagery.
- **Motion purpose:** Only brief state transitions when they help connect a selection to its result, with reduced-motion support.

## Tokens

| Token group | Decision |
| --- | --- |
| Color | Existing warm paper, pine action, brass accent, and semantic status palette. |
| Typography | Existing system sans/serif scale with tabular times. |
| Spacing | Reduce repeated vertical padding while retaining 44-pixel interactive targets. |
| Radius | Existing restrained 7–16 pixel radii. |
| Elevation | Light card and sheet shadows only. |
| Motion | 120 ms color/border feedback; no required animation. |

## Components and responsive behavior

- **Use / avoid:** Use native details/summary, buttons, live regions, and explicit time endpoints; avoid long always-open slot lists and icon-only meaning.
- **Phone behavior:** Two-row live feed, independently expandable dayparts with scroll
  cues, stacked unit schedule, and compact bottom navigation.
- **Desktop behavior:** The same Home-owned booking journey in a centered column; Admin
  retains its wider two-panel workspace.
- **Empty, loading, error, success states:** Each has visible text and a safe next action.
- **Accessibility decisions:** 44-pixel targets remain even where visible padding is reduced; arrows have labels; disclosure text includes its time range; color never carries status alone.
