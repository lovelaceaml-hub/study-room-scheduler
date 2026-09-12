# Member design choice

## Authorization and outcome

September 12, 2026: Anthony approved all four new directions and authorized production deployment with an opening choice to use a new design or remain on the existing app. Anthony then explicitly included Atlas and Lattice. Preserve all original prototypes. Publish six separate live experiences with the existing schedule and secure booking service, a remembered device preference, and a visible change-design/current-app path.

## Model and execution setup

- Controller and shared integration: Astra, maximum effort.
- Design lanes: one Astra, maximum effort, per Solace, Velum, Cove, Petal, Atlas, and Lattice. Each owns its experience folder in its own worktree.
- Reviewer: none, per Anthony's explicit no-review request.
- Verification: focused transport/policy tests, six member journeys using fictional fixtures, current-app regression checks, read-only production smoke.

## Boundaries

Production remains unchanged until the coordinated release. Only app Hosting and the existing memberSubmitBooking Function may be deployed. The Function receives optional requested-unit validation so a clicked room, board, or TV is respected transactionally; existing requests remain compatible. No rules, indexes, Authentication, legacy redirect, or unrelated Function change. Original Atlas and Lattice worktrees and prototypes stay unchanged.

## Build log

- 2026-09-12: Four design previews committed, backed up privately, and deployed to expiring channels. Phone layouts and simulated journeys passed. Production main 1706e0f24721423ec7cadb482d8e383917c92f6d and HTML SHA-256 7031ea640341aaae8688a059fab86d4c04e8c13ed598302d08e8a0fcdd811cb6 unchanged at checkpoint.
- 2026-09-12: Production scope authorized. Six lanes use one shared live transport and safe display projection; no lane may implement Firebase or backend writes independently.

- 2026-09-12: All six live lanes integrated. 24 model/policy/projection tests passed; six mocked live booking journeys and chooser checks passed, plus existing app, confirmation popup, and TV checks. Every design read the same live schedule before deployment. memberSubmitBooking and hosting:app deployed successfully. Original prototypes remain unchanged.
- 2026-09-12: Published verification passed for all six live schedule connections and the in-app chooser. Original protected prototypes and unrelated user file hashes match the starting baseline. Production artifacts match tested source hashes.
