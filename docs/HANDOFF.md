# Handoff: Study Room Scheduler

**Current update, 2026-10-11.** Production remains at
https://lvrooms.web.app. Pull request [#15](https://github.com/lovelaceaml-hub/study-room-scheduler/pull/15)
adds a read-only preflight before production Hosting deployment. It deploys an
automatically expiring one-day preview channel, checks the member page, Admin
page, lobby TV and live schedule API, then stops the production deployment if
any pre-release check fails. After a successful production deployment, the
workflow also checks those pages and the live schedule API.

The change is local on branch `cloud/release-read-only-smoke` and has not been
pushed or released. A push to this branch publishes a seven-day Hosting preview
that uses real reservation data and Functions, so it requires explicit release
approval. Independent review found no actionable issues. No production
reservation or account setting has been changed.

## Live surfaces

- Reservations: https://lvrooms.web.app
- Lobby TV: https://lvrooms.web.app/tv.html
- Admin: https://lvrooms.web.app/admin/

## Next

1. Commit the reviewed branch changes locally.
2. Anthony chooses the release mode before any push or publication.
3. If released, inspect the GitHub workflow summary for both preview and
   production checks. The one-day preflight channel expires automatically.

See the [active plan](PLAN-19-hosting-release-preflight.md) and
[run record](runs/plan-19-hosting-release-preflight/INDEX.md).
