# Reserve Now six-preview design wave

## Outcome

Create six isolated, phone-ready design previews that use the current live schedule in read-only mode while https://lvrooms.web.app remains unchanged. Atlas and Lattice are joined by Signal, Courtyard, Ledger, and Relay.

## Model and execution setup

- Controller: Sol, current task, owns safety, branch baselines, integration decisions, preview deployment, and completion truth.
- Design writers: six Sol design agents, one isolated worktree and one branch each.
- Mechanical support: Luna for focused verification, receipt collection, and repetitive branch checks.
- Review: Terra for the shared read-only boundary and aggregate design regression review.
- Runner: coordinator.

## Acceptance criteria

- Six branches exist and are pushed without merging to `main`.
- Each branch preserves the current production data shape and reads the same live schedule.
- All preview write paths are blocked locally before reaching Functions or Firestore.
- Every design shows the full vertical schedule with numbered resources side by side, hourly boundary labels, names, and Contact, New Member, or Other purpose.
- Clicking an open resource carries resource and start time into the reservation flow. The general reserve action still begins with resource choice.
- Each preview has a distinct composition, information hierarchy, schedule structure, and slot-selection interaction. Palette changes alone do not qualify as a new design.
- Production remains byte-for-byte untouched by deployment.
- Each branch passes syntax, policy, UI, confirmation-popup, TV, diff, and browser live-read/read-only checks.

## Lanes

### Lane 0: Shared live-read preview foundation

Sol owns the preview-only mutation guard, visible preview status, repository contract, and branch baseline.

### Lane 1: Atlas

Sol translates the approved warm Atlas language onto the current production application.

### Lane 2: Lattice

Sol translates the approved blue editorial Lattice language onto the current production application.

### Lane 3: Signal

Sol creates a bold civic-wayfinding direction with strong color blocks and fast scanning.

### Lane 4: Courtyard

Sol creates a calm architectural direction with warm stone, sage, and spatial rhythm.

### Lane 5: Ledger

Sol creates a disciplined editorial direction led by typography, rules, and compact information hierarchy.

### Lane 6: Relay

Sol creates a modern transit-inspired direction with connected time paths and crisp status coding.

### Lane 7: Verification and preview deployment

Luna runs repeated branch checks. Sol reviews receipts, pushes each branch, deploys unique Hosting preview channels, confirms live reads and blocked writes, then reports all links.

## Build log

- 2026-09-12: Anthony requested four new designs plus Atlas and Lattice, all in separate branches with live data and production preserved.
- 2026-09-12: Scope set to live Firestore reads with every mutation blocked in previews. Production merges and production deploys are out of scope.
- 2026-09-12: Anthony clarified that the six directions must be structurally different products, not color variants. All six Sol briefs were expanded to include schedule composition and interaction design.
