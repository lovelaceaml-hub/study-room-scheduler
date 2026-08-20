# Study Rooms retirement and redirect plan (DOCUMENT ONLY — nothing here has run)

Status: prepared in Rooms unification **Section 8 (rehearsal)**, 2026-08-19.
Owner directive (Anthony, 2026-08-19): **"Don't retire anything until it's
100% running."** Executing any step below is **Section 9** work and needs
Anthony's explicit go after the LV Zion scheduler
(https://lvzion.vercel.app/rooms) is verified 100% running in production.
Until then https://lvrooms.web.app stays live and authoritative, the write
kill switch stays disabled, and nothing in this repository is deployed.

## What Section 8 built (all inert until deployed)

| Piece | Where | Shipped state |
|---|---|---|
| Server-enforced write kill switch | `functions/lib/freeze.js`, guards in `functions/index.js`, `writesFrozen()` in `firestore.rules` | **Disabled**: the `app/writeFreeze` document does not exist; live behavior unchanged. Not deployed. |
| Freeze flip tool | `tools/freeze.mjs` | Emulator-only by default; refuses production without `--allow-production` + `--project lvz-rooms` + `STUDY_ROOMS_FREEZE_CONFIRM=lvz-rooms` |
| Retirement shell | `cutover/index.html` + `cutover/redirect.mjs` | Built, tested, **not deployed** |
| Retirement service worker | `cutover/sw.js` (served as `/sw.js` by the cutover config) | Built, tested, **not deployed** — deletes every `srs-v*` cache, unregisters, reloads clients onto the shell |
| Cutover hosting config | `firebase.cutover.json` | Present, **never passed to a deploy** |
| Migration rehearsal | `/Users/anthony/Projects/preaching` — `npm run rooms:migrate:rehearse` | Offline only (fixture export + in-memory Postgres); proves idempotency, row accounting, owner linking, conflicts, encrypted backup, rollback |

## Section 9 execution order (each step separately confirmed with Anthony)

1. **Preconditions.** LV Zion Rooms flags are ON in production, the scheduler
   is verified working for real members, and Anthony gives the cutover go.
2. **Deploy the switch (still disabled).**
   `npm_config_cache=/tmp/npm-cache npx -y firebase-tools@latest deploy --only functions,firestore:rules`
   from `/Users/anthony/Projects/study-room-scheduler`. Safe order: with no
   `app/writeFreeze` document, deployed behavior is byte-for-byte today's.
3. **Freeze old writes.**
   `STUDY_ROOMS_FREEZE_CONFIRM=lvz-rooms node tools/freeze.mjs --freeze --allow-production --project lvz-rooms --reason "LV Zion cutover"`.
   Verify: a member submission returns the read-only message; an owner
   cancellation is denied; boards still read.
4. **Final export + encrypted backup + final import** into LV Zion, then
   reconciliation — the exact flow rehearsed by
   `npm run rooms:migrate:rehearse`, now pointed at the real post-freeze
   export. Every source row must be accounted for before step 5.
5. **Redirect the old URL.**
   `npm_config_cache=/tmp/npm-cache npx -y firebase-tools@latest deploy --config firebase.cutover.json --only hosting:app`.
   This replaces lvrooms.web.app with the retirement shell; `/sw.js` becomes
   the retirement worker, so cached clients self-clean on their next visit or
   daily update check. The `legacy` hosting target already 301s to
   lvrooms.web.app and needs no change.
6. **Verify as a stale client.** A device that previously installed the PWA
   opens it: caches purge, the worker unregisters, the page lands on the
   shell and forwards to LV Zion; no reservation write path succeeds.

## Rollback (proven shape, also rehearsed)

- **Hosting:** `npx firebase-tools hosting:rollback` (or redeploy `firebase.json`
  from `main`) restores the old app shell. Reinstalled clients re-cache
  normally on their next visit.
- **Writes:** `node tools/freeze.mjs --unfreeze …` restores old-app writes
  **only after** proving LV Zion accepted no conflicting writes in the
  interim (the plan's split-brain rule).
- **Data:** the import is one transaction; a failed import self-rolls back.
  A completed-but-wrong import is removed with
  `DELETE FROM rooms_reservations WHERE source = 'firebase_import'`
  (allocations cascade; append-only audit evidence remains, by design).

## What is deliberately NOT planned

- No Firebase project deletion, no Firestore data deletion, no domain
  changes. Retirement means: writes frozen, hosting replaced by the shell,
  data preserved and exported.
- No deploy of any kind from this repository during Section 8.
