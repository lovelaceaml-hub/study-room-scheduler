# Lane 0 critique: coordinator rulings

Source: /Users/anthony/Projects/study-room-scheduler/docs/runs/2026-09-19-retire-classic-design/research/L0-critique.md (gpt-5.6-sol, high, read-only, canary verified).
Ruled by: Claude Fable 5.1, 2026-09-19. Every ruling is checked against the goal line: "Nothing a member or Admin can do today is lost."

| # | Finding | Ruling | Where it is corrected |
|---|---|---|---|
| 1 | Admin page loses the September 21 special schedule | Accepted, verified in special-schedule-entry.js | L4 (sent to the writer mid-run): patches carried natively into admin/admin.js, smoke case added |
| 2 | Root `tv=1`, `demo=1`, `test=1` go blank once app.js is deleted | Accepted, verified in design-choice.js and app.js init | L1 (sent mid-run): tv forwards to /tv.html, demo shows picker unsaved, test reported; L5 adds exact-URL browser checks |
| 3 | app.js holds the only service worker registration | Accepted, verified at app.js init | L1 (sent mid-run): registration moves to design-choice.js; L5 verifies fresh profile and update from the baseline worker |
| 4 | My reservations spec omits statuses, priority notices, rebook, original end, pending cancel, now marker | Accepted | L1 (sent mid-run) defines the matrix; L2 and L3 copy it |
| 5 | "Past" has no data contract | Accepted: past means the inactive records already inside myBookings, no historical fetch, no backend change | L1, then L2 and L3 |
| 6 | Admin smoke covers a fraction of Admin | Accepted | L4 (sent mid-run): approve, decline, reassign, reapprove, queue order, notes, session expiry, failed write |
| 7 | L2 cannot create its own test file; L3 acceptance names the L2 file | Accepted as a drafting slip: L2 owns test/member-mine-smoke-l2.mjs, L3 acceptance runs test/member-mine-smoke-l3.mjs | L2 and L3 kickoff prompts |
| 8 | `tab=admin` deep links not migrated | Accepted | L1 (sent mid-run): forwards to /admin/ |
| 9 | Deploy before commit | Accepted: commit the reviewed release candidate first, then deploy that commit | L5 |
| 10 | Work orders lack the goal line | Accepted: every kickoff prompt quotes it (done for L1 and L4 at launch) | all lanes |
| 11 | Accessibility and widths vague | Accepted: 320, 360, 375, 390 px assertions, focus return, axe run where the existing smokes already use it | L1 (sent mid-run), L2, L3, L5 walkthrough |

No ruling needs a backend change or new authority.
