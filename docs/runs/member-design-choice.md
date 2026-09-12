# Member design choice run

Controller: Astra, maximum effort. One Astra design writer per Solace, Velum, Cove, Petal, Atlas, and Lattice, each in its own worktree. Root owns shared transport, chooser, backend requested-unit support, integration, tests, Git, and release. No review cycle per Anthony's explicit instruction.

Original four previews were committed and pushed privately before production authorization. Original Atlas and Lattice files remain protected. Six live folders were built independently and copied into the integration branch. Root added shared manifest/chooser integration.

Verification uses safe fixtures only for write journeys. Real schedule validation reports counts and connection status, never names or private fields. Existing app, confirmation popup, and TV smoke checks passed. Focused policy tests cover exact selected-unit availability and backward compatibility. Six browser journeys cover all resources, Other details, failed saves, correct payloads, ownership, confirmed success, and offline blocking. Chooser checks cover six options, remaining current, remembered choice, and My reservations.

Release status: memberSubmitBooking and Hosting app deployed successfully. Six local integrations read the same live schedule before release. Published verification passed: all six production URLs loaded the live schedule with booking enabled and no sample mode. The in-app browser confirmed all six chooser options and Keep current. Published shared transport and chooser SHA-256s match the tested files. No synthetic production bookings were created; write checks used fictional Firebase responses.

## Lane source commits

- solace: `a30b80a78abffde74c04c5f44baab004c58cd3b2`
- velum: `48fdf785cdc796af9a7dd932024c1c1c41d73c9d`
- cove: `6a8e4531e152e51d3f6aeb8165da70b31f0611b4`
- petal: `3b47192be75108b5bd5ed69f6c1bdf5da1a47f36`
- atlas: `84fc3f927173f036b6b13ec1c55714543436a023`
- lattice: `55e11e80d58614a327ee8c8c0960fbef08ea2698`
