CANARY L0-058ecef2

## Ranked objections

1. **Critical: The new Admin page will lose the September 21 special schedule.**

   - What's wrong: Lane 4 is told to copy Admin behavior from `app.js`, while Lane 5 deletes `special-schedule-entry.js`. Raw `app.js` supports only Tuesday and Saturday. The special Monday is added at runtime by the file being deleted. The shared member model independently contains the special date, so member and Admin calendars would disagree.
   - Why it matters: Admin could not view, add, or manage September 21 reservations two days before the event. This directly contradicts the decision that the special schedule remains unchanged.
   - Evidence: The plan promises unchanged behavior at [line 34](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L34), instructs Lane 4 to copy `app.js` at [line 133](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L133), and deletes the special loader at [line 150](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L150). Raw `app.js` returns only Tuesday and Saturday at [app.js:207](https://github.com/lovelaceaml-hub/study-room-scheduler/blob/c7881acad0598741eec9c05b53c6f0dd01dfe1bf/app.js#L207). The deleted loader injects September 21 at [special-schedule-entry.js:14](https://github.com/lovelaceaml-hub/study-room-scheduler/blob/c7881acad0598741eec9c05b53c6f0dd01dfe1bf/special-schedule-entry.js#L14), while the member model adds it separately at [model.js:71](../../../../experiences/shared/model.js#L71).
   - Required correction: Make the special-date policy a shared dependency of the Admin page and add an Admin smoke case for September 21 before permitting deletion of the loader.

2. **Critical: The minimal root page conflicts with `tv=1`, `demo=1`, and `test=1`, producing blank entry routes.**

   - What's wrong: Lane 5 makes `/` load only `design-choice.js`. That script immediately returns for `tv` and `test`, and deliberately avoids both redirecting and opening the picker in demo mode. Those paths currently rely on `app.js`, which Lane 5 deletes.
   - Why it matters: The documented lobby link `/?tv=1`, the fictional-data demo, and root test mode can become blank pages. The plan says to preserve these behaviors but supplies no replacement routing or acceptance test for them.
   - Evidence: The deletion and minimal shell are ordered at [plan line 150](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L150). Lane 1 is told to keep these behaviors at [line 81](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L81). The current early return is at [design-choice.js:9](../../../../design-choice.js#L9), demo avoids the normal redirect at [design-choice.js:15](../../../../design-choice.js#L15), and demo avoids opening the picker at [design-choice.js:28](../../../../design-choice.js#L28). The current TV redirect lives in the deleted app at [app.js:2893](https://github.com/lovelaceaml-hub/study-room-scheduler/blob/c7881acad0598741eec9c05b53c6f0dd01dfe1bf/app.js#L2893). The public TV link is documented as `/?tv=1` at [README.md:43](../../../../README.md#L43).
   - Required correction: Set explicit destinations for all three root modes and add browser tests for each exact URL.

3. **Critical: Deleting `app.js` removes the only service worker registration.**

   - What's wrong: The plan updates `sw.js` but does not arrange for any surviving page to register it. A manifest link does not register a service worker.
   - Why it matters: New visitors and new installed copies will not receive offline assets or future worker updates. Existing registrations may mask the defect during local verification.
   - Evidence: The only registration is at [app.js:2889](https://github.com/lovelaceaml-hub/study-room-scheduler/blob/c7881acad0598741eec9c05b53c6f0dd01dfe1bf/app.js#L2889). The plan deletes that file at [plan line 150](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L150), then only edits the cache list at [line 151](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L151). Existing project requirements explicitly call for installation and offline verification at [HANDOFF.md:339](../../../HANDOFF.md#L339).
   - Required correction: Assign service worker registration to a surviving shared script and test a fresh browser profile, an installed launch, an update from the baseline worker, and a cold offline launch.

4. **High: The My reservations specification omits several member capabilities that exist today.**

   - What's wrong: The plan specifies date, time, resource, reserved-for detail, Cancel, and End early. It does not require pending, cancelled, declined, or overridden status presentation; priority-move and priority-release notices; Reserve another time; original end time after ending early; pending-request cancellation; or the Los Angeles time "now" marker.
   - Why it matters: An executor can meet every stated acceptance check while silently removing these member functions and explanations, contradicting the goal line.
   - Evidence: The narrow replacement contract is at [plan line 83](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L83), with tests limited to list, cancel, end early, and empty at [line 84](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L84). Current status sections are implemented at [app.js:1401](https://github.com/lovelaceaml-hub/study-room-scheduler/blob/c7881acad0598741eec9c05b53c6f0dd01dfe1bf/app.js#L1401), status labels at [app.js:1418](https://github.com/lovelaceaml-hub/study-room-scheduler/blob/c7881acad0598741eec9c05b53c6f0dd01dfe1bf/app.js#L1418), priority notices and rebooking at [app.js:1433](https://github.com/lovelaceaml-hub/study-room-scheduler/blob/c7881acad0598741eec9c05b53c6f0dd01dfe1bf/app.js#L1433), original end and actions at [app.js:1461](https://github.com/lovelaceaml-hub/study-room-scheduler/blob/c7881acad0598741eec9c05b53c6f0dd01dfe1bf/app.js#L1461), and the "now" behavior at [app.js:1213](https://github.com/lovelaceaml-hub/study-room-scheduler/blob/c7881acad0598741eec9c05b53c6f0dd01dfe1bf/app.js#L1213). The shared model already exposes `endedEarlyFrom`, `priorityNotice`, and action flags at [model.js:125](../../../../experiences/shared/model.js#L125).
   - Required correction: Define the complete reservation-state matrix and require every state and action in all six journey tests.

5. **High: "Upcoming and past reservations" has no settled data contract.**

   - What's wrong: The plan asks for upcoming and past reservations, but the local projection filters owned bookings to currently eligible days. The current classic screen calls inactive records "Past reservations" while also describing the list as every upcoming reservation. The plan never decides whether "past" means historical dates or inactive statuses.
   - Why it matters: With backend changes prohibited, a writer may build a historical section for data the callable does not return, or classify current cancelled and overridden records differently in each design.
   - Evidence: The requirement appears at [plan line 82](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L82). Owned projection excludes dates outside `days` at [model.js:114](../../../../experiences/shared/model.js#L114). The existing screen says "every upcoming reservation" at [app.js:1398](https://github.com/lovelaceaml-hub/study-room-scheduler/blob/c7881acad0598741eec9c05b53c6f0dd01dfe1bf/app.js#L1398), but labels inactive records as past at [app.js:1410](https://github.com/lovelaceaml-hub/study-room-scheduler/blob/c7881acad0598741eec9c05b53c6f0dd01dfe1bf/app.js#L1410).
   - Required correction: Define "past," document the exact `myBookings` records available from the unchanged backend, and provide fixtures for each required category.

6. **High: Admin acceptance covers only a fraction of the behavior promised for preservation.**

   - What's wrong: Lane 4 promises the entire Admin experience, but its smoke test covers only lock, unlock, day list, add, cancel, end early, and lock again.
   - Why it matters: Approval, decline, reassignment, reapproval, priority queue ordering, private notes, note migration, Baptism Room migration, housekeeping, session expiry, invalid-session relocking, and failed-write recovery could all be broken while acceptance passes.
   - Evidence: The broad promise is at [plan line 133](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L133), while the limited acceptance is at [line 135](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L135). Current approve and decline paths are at [app.js:2107](https://github.com/lovelaceaml-hub/study-room-scheduler/blob/c7881acad0598741eec9c05b53c6f0dd01dfe1bf/app.js#L2107), reapproval at [app.js:2776](https://github.com/lovelaceaml-hub/study-room-scheduler/blob/c7881acad0598741eec9c05b53c6f0dd01dfe1bf/app.js#L2776), private-note loading at [app.js:2016](https://github.com/lovelaceaml-hub/study-room-scheduler/blob/c7881acad0598741eec9c05b53c6f0dd01dfe1bf/app.js#L2016), migrations at [app.js:2535](https://github.com/lovelaceaml-hub/study-room-scheduler/blob/c7881acad0598741eec9c05b53c6f0dd01dfe1bf/app.js#L2535), and cleanup at [app.js:2556](https://github.com/lovelaceaml-hub/study-room-scheduler/blob/c7881acad0598741eec9c05b53c6f0dd01dfe1bf/app.js#L2556). The existing rollout contract explicitly requires approve, decline, reassignment, direct-add, and lock at [HANDOFF.md:304](../../../HANDOFF.md#L304).
   - Required correction: Expand the Admin behavior matrix and mocked smoke coverage before treating Admin parity as verifiable.

7. **High: Lane 2 is forbidden from creating its required test, and Lane 3 inherits an impossible acceptance command.**

   - What's wrong: Lane 2 ownership lists only three experience folders, but its work requires creating `test/member-mine-smoke-l2.mjs`. Its compiled order forbids edits outside the ownership allowlist. Lane 3 branches from L1 and says it has the same acceptance as Lane 2, which literally includes running an L2 test file that will not exist in its branch.
   - Why it matters: Writers must violate hard ownership rules, skip required coverage, or guess that the plan meant something else.
   - Evidence: Lane 2 ownership is at [plan line 101](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L101), while the new test is required at [line 103](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L103). The compiled L2 hard rule restricts edits at [L2.md:9](../orders/L2.md#L9). Lane 3 says "Same work and acceptance as Lane 2" at [plan line 118](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L118), but depends only on L1 at [line 113](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L113).
   - Required correction: Add the L2 test path to L2 ownership and write an explicit L3 acceptance command using `member-mine-smoke-l3.mjs`.

8. **High: Existing Admin deep links are not migrated.**

   - What's wrong: The current app accepts `tab=admin`. The plan creates `/admin/` but provides compatibility behavior only for `tab=mine`; all other classic links go to a member design or picker.
   - Why it matters: Existing Admin bookmarks and shared links such as `/?classic=1&tab=admin` or `/?tab=admin` will stop opening Admin.
   - Evidence: The current route handling accepts both `mine` and `admin` at [app.js:2897](https://github.com/lovelaceaml-hub/study-room-scheduler/blob/c7881acad0598741eec9c05b53c6f0dd01dfe1bf/app.js#L2897). The plan special-cases only `tab=mine` at [plan line 29](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L29), even though Admin moves to `/admin/` at [line 32](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L32). Picker tests likewise cover only `classic=1&tab=mine` at [line 84](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L84).
   - Required correction: Define and test redirects from both legacy Admin URL forms to `/admin/`, preserving any safe query state.

9. **Medium: The release sequence deploys code before recording the exact release commit.**

   - What's wrong: Lane 5 says deploy, production-smoke, then commit and merge. It also offers a preview channel as an alternative without defining whether preview is merely staging or counts as completion of the production goal.
   - Why it matters: A production deployment may not correspond to any recoverable commit if later commit or merge steps fail. Choosing preview also leaves the requested root cutover incomplete without a documented promotion step.
   - Evidence: The ordering and unresolved release alternatives are both at [plan line 156](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L156). Rollback names only the old baseline deployment at [line 159](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L159).
   - Required correction: Commit and identify the reviewed release candidate before deployment. Define preview as a staging state with a separate promotion gate, and add post-rollback checks for root routing, Admin, TV, and service worker state.

10. **Medium: The compiled work orders do not carry the plan’s governing goal, despite the plan requiring that.**

   - What's wrong: The plan says every work order must quote and check the goal line first. The compiled implementation orders begin with lane identity and hard rules, then jump directly to the lane block.
   - Why it matters: Writers do not receive the decisive requirement that nothing a member or Admin can do may be lost. That omission directly enables the parity gaps above.
   - Evidence: The requirement is at [plan line 12](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L12). The L1 order moves from its heading and hard rules to the copied lane block at [L1.md:3](../orders/L1.md#L3) and [L1.md:21](../orders/L1.md#L21), without the goal.
   - Required correction: Regenerate every order with the exact goal line and a parity checklist specific to that lane.

11. **Medium: Accessibility and responsive acceptance is too vague to verify.**

   - What's wrong: "Keyboard and screen-reader reachable" and "same accessibility bar" name no focus, dialog, announcement, label, zoom, or automated accessibility checks. Lane 5 retires or rewrites the existing UI smoke, and the walkthrough checks only 360px and desktop even though the maintained contract requires 320px, 375px, and 390px.
   - Why it matters: Six newly added reservation-management screens and a copied Admin application can regress keyboard focus, modal containment, announcements, or narrow-phone layout while every named command passes.
   - Evidence: The vague acceptance is at [plan line 86](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L86) and [line 105](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L105). Existing smoke tests are rewritten or retired at [line 153](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L153), while the walkthrough uses 360px at [line 154](../../../PLAN-RETIRE-CLASSIC-DESIGN.md#L154). The maintained verification widths are specified at [HANDOFF.md:335](../../../HANDOFF.md#L335).
   - Required correction: Name the automated accessibility audit, keyboard journeys, focus-return checks, live-region checks, touch-target measurements, and 320px, 375px, and 390px viewport assertions.

**Immediate action:** Resolve objections 1 through 8 in the plan and regenerate the affected work orders before integration or release begins.