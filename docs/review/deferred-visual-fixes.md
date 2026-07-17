# Deferred visual fixes — feed these into the redesign

These confirmed review findings are visual, so they are fixed by the Phase B CSS rewrite instead of being patched twice. The redesign is NOT done until each box is checked.

## [ ] MUST FIX: header nav overlap
- Where: index.html:440 (high)
- The absolute-positioned nav (v3 generation) overlaps the header text; My reservations / Admin render cramped and partially illegible on load. The rewrite must give the header/tab bar a single sane layout.

## [ ] `.wrap` max-width 1100px (base) dead, overridden to 760px by v3 gen
- Where: index.html:433 (medium)
- Base gen: `.wrap { max-width: 1100px; margin: 0 auto; padding: 0 16px 90px; }` (line 59). v3 gen redeclares: `.wrap { max-width: 760px; padding-bottom: 56px; }` (line 433). Identical specificity, v3 wins for max-width and padding-bottom (padding-left/right 16px from base survive since not redeclared). The two 'wrap' philosophies (wide 1100px multi-column desktop layout vs narrow 760px phone-first booking flow) coexist in the source but only the 760px number is ever live.

## [ ] `.chip-podium` CSS rule is entirely dead — never emitted by app.js
- Where: index.html:328 (low)
- `.chip-podium { position: absolute; bottom: 4px; right: 6px; font-size: 9px; ... }` (lines 328-331) has zero matching markup. `grep -n "chip-podium" app.js` returns no hits; app.js only mentions 'podium' in prose comments (lines 36-37, 442-443, 711) explaining that podiums are bundled with whiteboards and no longer separate inventory — the UI element that would have used this class was removed from app.js but the CSS was never cleaned up.

## [ ] `.ref-tag` / `.ref-link` are dead CSS — no matching markup in app.js
- Where: index.html:124 (low)
- `.ref-tag` (lines 124-128) and `.ref-link` (line 129) have zero occurrences anywhere in app.js (`grep -c "ref-tag\|ref-link" app.js` = 0). No template string in app.js ever emits these classes.

## [ ] `.service-notices` / `.service-notice` dead CSS (plus its dedicated mobile media-query rule)
- Where: index.html:224 (low)
- Lines 224-226 define a full component (`.service-notices` grid wrapper, `.service-notice` flex row, `.service-notice strong`), and the mobile `@media (max-width:520px)` block even carries a dedicated override at line 412 (`.service-notice { flex-direction: column; gap: 1px; }`). None of these classes appear anywhere in app.js — the actual service/closure notice UI in app.js uses `.service-track`, `.service-ruler`, `.mobile-service-block`, and `.availability-service` instead (all of which ARE used).

## [ ] Entire 'progressive disclosure' schedule-details/more-details component (v3 gen) is dead — no `<details>`/`<summary>` element exists in app.js
- Where: index.html:469 (low)
- v3 gen defines a whole collapsible-details subsystem: `.schedule-details` (469, plus 472-474 descendant rules hiding `.legend`/`.calendar-help`/`.pending-lane`/`.wait-strip` inside it), `.schedule-details-body` (471), and `.more-details` + `.more-details[open] summary` (483-484), with a shared summary rule at line 470 (`.schedule-details summary, .more-details summary { ... }`). `grep -n "<details\|<summary" app.js` returns zero matches — app.js never emits a `<details>` element anywhere, so `.schedule-details`, `.schedule-details-body`, and `.more-details` (and their descendant-hiding rules) 

## [ ] Heading typeface (serif vs sans) is inconsistent per-container, not per-heading-level — same `<h2>` renders in two different typefaces depending on parent class
- Where: index.html:58 (low)
- Base rule `h1, h2, h3, h4 { font-family: var(--serif); ... }` (line 58) is the only rule governing plain `<h2>` elements. app.js emits many bare `<h2>` inside `.card` with no font-family override — e.g. `<h2>Who's requesting</h2>` (app.js:866), `<h2>My requests</h2>` (app.js:982), `<h2>Pending requests</h2>` (app.js:1381), `<h2>Day overview</h2>` (app.js:1510), `<h2>Add a booking</h2>` (app.js:1673), `<h2>Housekeeping</h2>` (app.js:1747) — all render serif per the base rule (only `.card h2` font-size is touched at line 122). Meanwhile v3/v4 gens add container-specific sans overrides for other 

## [ ] `.sync-pill` connected/'on' state loses its green status color to a later same-specificity override; disconnected/'off' state survives only because of a higher-specificity class
- Where: index.html:438 (low)
- Base defines the connected (default, no `.off`) state as `.sync-pill { ... background: var(--green-tint); color: var(--green); ... }` (lines 79-84) and the disconnected state as `.sync-pill.off { background: var(--amber-tint); color: #8A5A12; }` (lines 86-87). v3 gen redeclares the bare selector: `.sync-pill { font-size: 10px; padding: 4px 9px; background: transparent; color: var(--ink-faint); }` (line 438). Because `.sync-pill` and `.sync-pill.off` have different specificity (0,1,0 vs 0,2,0), `.sync-pill.off`'s amber styling still wins when offline — but the connected/'on' state has no higher

## [ ] tv.css is a fully separate design-token system from index.html's member app — no shared CSS variables, radius scale, or class vocabulary
- Where: tv.css:1 (low)
- tv.css defines its own `:root` palette with different names and different values than the member app: `--blue: #2948b8` vs member app's `--primary: #2B4BC0` (similar but distinct hex), `--green: #147451` vs member app's `--green: #188A5E` (same name, different value — a real drift risk if someone assumes shared tokens), plus its own `--label-width` clamp and hardcoded border-radius values (18px, 16px, 7px, 3px at tv.css lines 125, 144, 265, 319/349) with no equivalent to index.html's `--r-sm/--r-md/--r-lg` (6/8/10px) scale. Class names are also entirely disjoint: tv.js emits `.service-block`, 

## [ ] ~230 lines of an entire alternate booking UI (scheduleGridHtml/categoryGroupHtml/mobileBookingCalendarHtml/availabilityPickerHtml/openBookingFromCell) are dead code with an incompatible data shape, a landmine for the next edit
- Where: app.js:844 (low)
- scheduleGridHtml() (844) and everything it calls — categoryGroupHtml (718), mobileBookingCalendarHtml (786), availabilityPickerHtml (806) — are defined but never invoked anywhere in the render tree (verified: renderSchedule/renderAdmin never call scheduleGridHtml). Their only entry point, openBookingFromCell() (1064, bound to data-act="open-booking"), builds a signup draft with `needs`/`preferredRoom` fields and no `resourceType`, while the live modal bookingModalHtml() (1257) and submitSignup() (1276-1308) read `d.resourceType` exclusively. If anyone re-wires an 'open-booking' button back in 

## [ ] Unused CSS selector .chip-podium
- Where: index.html:328 (low)
- .chip-podium class is defined in CSS (lines 328-331) but never referenced or generated by any code in app.js. Comments in app.js explicitly note that podiums are no longer separate inventory (lines 36-37, 442-443), yet this CSS rule remains.
