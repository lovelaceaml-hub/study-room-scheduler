#!/usr/bin/env bash
# deploy-guard.sh: refuses any Firebase CLI command whose targets differ from
# this repository's pinned Hosting scope. The GitHub workflows call it with the
# exact argument list they are about to pass to firebase-tools, in the same step.
#
# Usage:
#   .github/scripts/deploy-guard.sh deploy --only <scope> --project <id> --non-interactive
#   .github/scripts/deploy-guard.sh hosting:channel:deploy <channel> [--only <target>] --project <id> --expires <n>d --json
#   .github/scripts/deploy-guard.sh --self-test
#
# Exit 0 means the command matches the pinned scope exactly. Anything else exits 1.
set -euo pipefail

# Pinned scope for this repository. Change only with the owner's approval.
PINNED_PROJECT="lvz-rooms"
PINNED_RELEASE_ONLY="hosting:app"
# Hosting target for preview channels. Empty means this repo has a single
# Hosting site with no target, and preview commands must not pass --only.
PINNED_PREVIEW_ONLY="app"

fail() {
  echo "deploy-guard: REFUSED: $*" >&2
  exit 1
}

self_test() {
  local me="$0" pass=0 bad=0
  expect() {
    local want="$1"; shift
    local got=allowed
    if ! "$me" "$@" >/dev/null 2>&1; then got=refused; fi
    if [ "$got" = "$want" ]; then
      pass=$((pass + 1)); echo "ok   ($want) firebase $*"
    else
      bad=$((bad + 1)); echo "FAIL (wanted $want, got $got) firebase $*"
    fi
  }
  local P="$PINNED_PROJECT" R="$PINNED_RELEASE_ONLY"
  local -a PV=()
  if [ -n "$PINNED_PREVIEW_ONLY" ]; then PV=(--only "$PINNED_PREVIEW_ONLY"); fi

  expect allowed deploy --only "$R" --project "$P" --non-interactive
  expect allowed hosting:channel:deploy test-branch ${PV[@]+"${PV[@]}"} --project "$P" --expires 7d --json
  expect refused deploy
  expect refused deploy --project "$P" --non-interactive
  expect refused deploy --only functions --project "$P" --non-interactive
  expect refused deploy --only "$R,functions" --project "$P" --non-interactive
  expect refused deploy --only "$R,firestore:rules" --project "$P" --non-interactive
  expect refused deploy --only hosting,firestore --project "$P" --non-interactive
  expect refused deploy --only storage --project "$P" --non-interactive
  expect refused deploy --only "$R" --project some-other-project --non-interactive
  expect refused deploy --only "$R" --non-interactive
  expect refused deploy --only "$R" --project "$P"
  expect refused deploy --only "$R" --only functions --project "$P" --non-interactive
  expect refused deploy --only "$R" --except functions --project "$P" --non-interactive
  expect refused deploy --only "$R" --project "$P" --non-interactive --force
  expect refused hosting:channel:deploy live ${PV[@]+"${PV[@]}"} --project "$P" --expires 7d --json
  expect refused hosting:channel:deploy "Bad_Channel" ${PV[@]+"${PV[@]}"} --project "$P" --expires 7d --json
  expect refused hosting:channel:deploy test-branch --only functions --project "$P" --expires 7d --json
  expect refused hosting:clone "$P:live" "$P:live"
  expect refused functions:delete wmGroupmePost --project "$P"
  if [ "$R" != "hosting" ]; then
    expect refused deploy --only hosting --project "$P" --non-interactive
  fi
  echo "deploy-guard self-test: $pass passed, $bad failed"
  [ "$bad" -eq 0 ]
}

[ "$#" -ge 1 ] || fail "no command given (a bare 'firebase' call is not allowed)"
if [ "$1" = "--self-test" ]; then
  self_test
  exit $?
fi

sub="$1"; shift
case "$sub" in
  deploy)
    mode=release
    want_only="$PINNED_RELEASE_ONLY"
    [ -n "$want_only" ] || fail "release scope is not pinned"
    ;;
  hosting:channel:deploy)
    mode=preview
    want_only="$PINNED_PREVIEW_ONLY"
    [ "$#" -ge 1 ] || fail "preview needs a channel id"
    channel="$1"; shift
    [[ "$channel" =~ ^[a-z0-9][a-z0-9-]{0,39}$ ]] || fail "channel id '$channel' is not a plain lowercase id"
    [ "$channel" != "live" ] || fail "the live channel is production, not a preview"
    ;;
  *)
    fail "subcommand '$sub' is not allowed; only 'deploy' and 'hosting:channel:deploy'"
    ;;
esac

only=""; seen_only=0; project=""; seen_project=0; non_interactive=0; expires=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --only)
      [ "$#" -ge 2 ] || fail "--only needs a value"
      [ "$seen_only" -eq 0 ] || fail "--only given more than once"
      only="$2"; seen_only=1; shift 2 ;;
    --project)
      [ "$#" -ge 2 ] || fail "--project needs a value"
      [ "$seen_project" -eq 0 ] || fail "--project given more than once"
      project="$2"; seen_project=1; shift 2 ;;
    --non-interactive)
      non_interactive=1; shift ;;
    --json)
      [ "$mode" = preview ] || fail "--json is only used for previews"
      shift ;;
    --expires)
      [ "$mode" = preview ] || fail "--expires is only used for previews"
      [ "$#" -ge 2 ] || fail "--expires needs a value"
      expires="$2"; shift 2 ;;
    *)
      fail "argument '$1' is not allowed" ;;
  esac
done

if [ "$mode" = release ] && [ "$seen_only" -eq 0 ]; then
  fail "a deploy without --only is not allowed (it would publish every target)"
fi

[ "$project" = "$PINNED_PROJECT" ] || fail "project '$project' is not the pinned project '$PINNED_PROJECT'"

case ",$only," in
  *,functions*|*,firestore*|*,storage*|*,database*|*,remoteconfig*|*,extensions*|*,auth*|*,dataconnect*|*,apphosting*)
    fail "--only '$only' names a non-Hosting target" ;;
esac

if [ "$mode" = release ]; then
  [ "$seen_only" -eq 1 ] || fail "a deploy without --only is not allowed"
  [ "$only" = "$want_only" ] || fail "--only '$only' differs from the pinned '$want_only'"
  [ "$non_interactive" -eq 1 ] || fail "release must run with --non-interactive"
else
  if [ -n "$want_only" ]; then
    [ "$seen_only" -eq 1 ] && [ "$only" = "$want_only" ] || fail "preview --only '$only' differs from the pinned '$want_only'"
  else
    [ "$seen_only" -eq 0 ] || fail "this repo has one Hosting site; preview must not pass --only"
  fi
  [[ "$expires" =~ ^([1-9]|[12][0-9]|30)d$ ]] || fail "preview must set --expires between 1d and 30d"
fi

echo "deploy-guard: allowed: firebase $sub${channel:+ $channel} (scope: ${only:-single Hosting site}, project: $project)"
