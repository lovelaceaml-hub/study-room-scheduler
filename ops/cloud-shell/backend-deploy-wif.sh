#!/usr/bin/env bash
# Keyless GitHub deploy identities for the church Firebase backends.
#
# Run ONCE in Google Cloud Shell (https://shell.cloud.google.com), signed in as
# the Google account that owns lv-zion-duties, lvz-rooms and lv-wm-prayer:
#
#   bash backend-deploy-wif.sh
#
# Safe to run again: every step checks first and only adds what is missing.
# It creates no keys and prints no secrets. At the end it prints the values to
# paste as GitHub repository VARIABLES (not secrets; they are not sensitive).
#
# What it sets up (spec P2-C sections 1.4, 1.5, 6 and 7):
#   1. Workload Identity pool "github" in lv-zion-duties (shared with the
#      backup lane; created only if missing, never changed if present).
#   2. One OIDC provider per gated workflow. Google refuses a token unless the
#      run is in that exact repository (by id), on refs/heads/main, started by
#      the allowed event, from that exact workflow file on main.
#   3. Deploy service accounts with only the roles in the spec table:
#        gh-backend-deploy@lv-zion-duties   Worship Duty Functions + rules
#        gh-backend-deploy@lvz-rooms        Study Rooms Functions + rules
#        gh-rules-deploy@lv-wm-prayer       Morning Prayer rules only
#      and read-only drift identities:
#        gh-functions-drift@lv-zion-duties, gh-functions-drift@lvz-rooms
#   4. Each service account trusts ONLY its own provider (attribute.gate),
#      so a token from one workflow can never act as another workflow's account.
#   5. The Artifact Registry cleanup policy (old Functions images are deleted
#      after 1 day), so firebase-tools does not end a good deploy in red.
#
# Optional, only if the first Worship Functions release is refused for
# "datastore.databases.getMetadata" (Firestore-triggered functions):
#   ADD_FIRESTORE_METADATA_ROLE=1 bash backend-deploy-wif.sh
# adds a custom role holding only that one permission (never datastore.viewer,
# which could read member data).
#
# Undo (per account): gcloud iam service-accounts delete <email> --project <p>
# and gcloud iam workload-identity-pools providers delete <id> --location global
#   --workload-identity-pool github --project lv-zion-duties
set -euo pipefail

POOL_PROJECT="lv-zion-duties"
POOL="github"
OWNER="lovelaceaml-hub"
OWNER_ID="281993171"
ISSUER="https://token.actions.githubusercontent.com"

# GitHub repository ids (stable even if a repository is renamed or recreated).
REPO_ID_WORSHIP="1292873846"
REPO_ID_ROOMS="1303168396"
REPO_ID_PRAYER="1292886573"

say() { echo ""; echo "==> $*"; }
info() { echo "    $*"; }

command -v gcloud >/dev/null || { echo "gcloud is missing; run this in Google Cloud Shell." >&2; exit 1; }
ACCOUNT="$(gcloud config get-value account 2>/dev/null || true)"
[ -n "$ACCOUNT" ] || { echo "No gcloud account is signed in. Run: gcloud auth login" >&2; exit 1; }
say "Signed in as $ACCOUNT"

project_number() { gcloud projects describe "$1" --format='value(projectNumber)'; }

ensure_api() {
  local project="$1" api="$2"
  if gcloud services list --enabled --project "$project" --filter="config.name=$api" --format='value(config.name)' | grep -qx "$api"; then
    info "$api already enabled in $project"
  else
    info "enabling $api in $project"
    gcloud services enable "$api" --project "$project"
  fi
}

ensure_sa() {
  local project="$1" name="$2" display="$3"
  local email="$name@$project.iam.gserviceaccount.com"
  if gcloud iam service-accounts describe "$email" --project "$project" >/dev/null 2>&1; then
    info "service account $email exists"
  else
    info "creating service account $email"
    gcloud iam service-accounts create "$name" --project "$project" --display-name "$display" >/dev/null
  fi
}

project_role() {
  local project="$1" email="$2" role="$3"
  info "grant $role on project $project to $email"
  gcloud projects add-iam-policy-binding "$project" --member "serviceAccount:$email" --role "$role" --condition=None --quiet >/dev/null
}

# The account 2nd gen Functions run as. Read from a live function when possible.
runtime_sa() {
  local project="$1" region="$2" fn="$3" sa
  sa="$(gcloud functions describe "$fn" --project "$project" --region "$region" --format='value(serviceConfig.serviceAccountEmail)' 2>/dev/null || true)"
  if [ -z "$sa" ]; then
    sa="$(project_number "$project")-compute@developer.gserviceaccount.com"
    info "could not read $fn; assuming the default compute account $sa" >&2
  fi
  echo "$sa"
}

act_as() {
  local project="$1" deployer="$2" runtime="$3"
  info "allow $deployer to act as the runtime account $runtime (serviceAccountUser on that account only)"
  gcloud iam service-accounts add-iam-policy-binding "$runtime" --project "$project" \
    --member "serviceAccount:$deployer" --role roles/iam.serviceAccountUser --condition=None --quiet >/dev/null
}

ensure_pool() {
  if gcloud iam workload-identity-pools describe "$POOL" --project "$POOL_PROJECT" --location global >/dev/null 2>&1; then
    info "pool $POOL already exists in $POOL_PROJECT (left as it is)"
  else
    info "creating pool $POOL in $POOL_PROJECT"
    gcloud iam workload-identity-pools create "$POOL" --project "$POOL_PROJECT" --location global \
      --display-name "GitHub Actions" --description "Keyless GitHub Actions identities (lovelaceaml-hub)" >/dev/null
  fi
}

# ensure_provider <provider id> <repo> <repo id> <workflow file> <events CEL list> <gate value>
ensure_provider() {
  local id="$1" repo="$2" repo_id="$3" wf="$4" events="$5" gate="$6"
  local wref="$OWNER/$repo/.github/workflows/$wf@refs/heads/main"
  local condition="assertion.repository_owner_id == '$OWNER_ID' && assertion.repository_id == '$repo_id' && assertion.repository == '$OWNER/$repo' && assertion.ref == 'refs/heads/main' && assertion.event_name in $events && assertion.workflow_ref == '$wref'"
  # ";" is the list separator (gcloud's ^;^ form) because the gate expression is CEL.
  local mapping="^;^google.subject=assertion.sub;attribute.repository=assertion.repository;attribute.ref=assertion.ref;attribute.event_name=assertion.event_name;attribute.workflow_ref=assertion.workflow_ref;attribute.gate=assertion.workflow_ref == '$wref' ? '$gate' : 'none'"
  if gcloud iam workload-identity-pools providers describe "$id" --project "$POOL_PROJECT" --location global --workload-identity-pool "$POOL" >/dev/null 2>&1; then
    info "updating provider $id (condition re-applied)"
    gcloud iam workload-identity-pools providers update-oidc "$id" --project "$POOL_PROJECT" --location global \
      --workload-identity-pool "$POOL" --issuer-uri "$ISSUER" \
      --attribute-mapping "$mapping" --attribute-condition "$condition" >/dev/null
  else
    info "creating provider $id for $OWNER/$repo $wf"
    gcloud iam workload-identity-pools providers create-oidc "$id" --project "$POOL_PROJECT" --location global \
      --workload-identity-pool "$POOL" --issuer-uri "$ISSUER" --display-name "$id" \
      --attribute-mapping "$mapping" --attribute-condition "$condition" >/dev/null
  fi
}

# Only tokens from the provider that maps this gate value may act as the account.
trust_gate() {
  local sa_project="$1" email="$2" gate="$3"
  local member="principalSet://iam.googleapis.com/projects/$POOL_NUMBER/locations/global/workloadIdentityPools/$POOL/attribute.gate/$gate"
  info "let gate '$gate' act as $email (workloadIdentityUser)"
  gcloud iam service-accounts add-iam-policy-binding "$email" --project "$sa_project" \
    --role roles/iam.workloadIdentityUser --member "$member" --condition=None --quiet >/dev/null
}

cleanup_policy() {
  local project="$1" region="$2"
  if ! gcloud artifacts repositories describe gcf-artifacts --project "$project" --location "$region" >/dev/null 2>&1; then
    info "no gcf-artifacts repository in $project/$region yet; skipped (run this script again after the first deploy there)"
    return 0
  fi
  local policy; policy="$(mktemp)"
  # Same policy name and age as "firebase functions:artifacts:setpolicy" (1 day).
  printf '%s\n' '[{"name":"firebase-functions-cleanup","action":{"type":"Delete"},"condition":{"tagState":"any","olderThan":"86400s"}}]' > "$policy"
  info "cleanup policy on $project/$region/gcf-artifacts: delete images older than 1 day"
  gcloud artifacts repositories set-cleanup-policies gcf-artifacts --project "$project" --location "$region" \
    --policy "$policy" --no-dry-run >/dev/null
  rm -f "$policy"
}

sources_bucket_reader() {
  local project="$1" region="$2" email="$3"
  local bucket="gs://gcf-v2-sources-$(project_number "$project")-$region"
  if gcloud storage buckets describe "$bucket" >/dev/null 2>&1; then
    info "grant storage.objectViewer on $bucket to $email"
    gcloud storage buckets add-iam-policy-binding "$bucket" --member "serviceAccount:$email" \
      --role roles/storage.objectViewer >/dev/null
  else
    info "bucket $bucket not found; the drift check will report the source as not readable"
  fi
}

say "Projects"
for p in "$POOL_PROJECT" lvz-rooms lv-wm-prayer; do
  gcloud projects describe "$p" --format='value(projectId)' >/dev/null || { echo "Cannot see project $p with this account." >&2; exit 1; }
  info "$p (number $(project_number "$p"))"
done
POOL_NUMBER="$(project_number "$POOL_PROJECT")"

say "APIs needed for keyless sign-in"
ensure_api "$POOL_PROJECT" iam.googleapis.com
ensure_api "$POOL_PROJECT" iamcredentials.googleapis.com
ensure_api "$POOL_PROJECT" sts.googleapis.com
for p in lvz-rooms lv-wm-prayer; do ensure_api "$p" iamcredentials.googleapis.com; done

say "Workload Identity pool"
ensure_pool

say "Providers (one per gated workflow)"
ensure_provider worship-backend worship-duty-app "$REPO_ID_WORSHIP" firebase-backend-release.yml "['workflow_dispatch']" worship-backend-release
ensure_provider rooms-backend study-room-scheduler "$REPO_ID_ROOMS" firebase-backend-release.yml "['workflow_dispatch']" rooms-backend-release
ensure_provider prayer-rules morning-prayer-app "$REPO_ID_PRAYER" firebase-rules-release.yml "['workflow_dispatch']" prayer-rules-release
ensure_provider worship-drift worship-duty-app "$REPO_ID_WORSHIP" functions-drift.yml "['schedule', 'workflow_dispatch']" worship-functions-drift
ensure_provider rooms-drift study-room-scheduler "$REPO_ID_ROOMS" functions-drift.yml "['schedule', 'workflow_dispatch']" rooms-functions-drift

say "Worship Duty (lv-zion-duties): gh-backend-deploy"
W_SA="gh-backend-deploy@lv-zion-duties.iam.gserviceaccount.com"
ensure_sa lv-zion-duties gh-backend-deploy "GitHub backend release (Worship Duty)"
for role in roles/cloudfunctions.developer roles/cloudscheduler.admin roles/serviceusage.serviceUsageConsumer roles/firebasehosting.viewer roles/firebaserules.admin; do
  project_role lv-zion-duties "$W_SA" "$role"
done
act_as lv-zion-duties "$W_SA" "$(runtime_sa lv-zion-duties us-central1 checkSheet)"
if [ "${ADD_FIRESTORE_METADATA_ROLE:-0}" = "1" ]; then
  if ! gcloud iam roles describe firestoreDatabaseMetadataReader --project lv-zion-duties >/dev/null 2>&1; then
    info "creating custom role firestoreDatabaseMetadataReader (datastore.databases.getMetadata only)"
    gcloud iam roles create firestoreDatabaseMetadataReader --project lv-zion-duties \
      --title "Firestore database metadata reader" --permissions datastore.databases.getMetadata --stage GA >/dev/null
  fi
  project_role lv-zion-duties "$W_SA" "projects/lv-zion-duties/roles/firestoreDatabaseMetadataReader"
fi
trust_gate lv-zion-duties "$W_SA" worship-backend-release

say "Study Rooms (lvz-rooms): gh-backend-deploy"
R_SA="gh-backend-deploy@lvz-rooms.iam.gserviceaccount.com"
ensure_sa lvz-rooms gh-backend-deploy "GitHub backend release (Study Rooms)"
for role in roles/cloudfunctions.developer roles/serviceusage.serviceUsageConsumer roles/firebasehosting.viewer roles/firebaserules.admin; do
  project_role lvz-rooms "$R_SA" "$role"
done
act_as lvz-rooms "$R_SA" "$(runtime_sa lvz-rooms us-west1 memberSchedule)"
info "grant secretmanager.viewer on secret STUDY_ROOM_ADMIN_PIN only"
gcloud secrets add-iam-policy-binding STUDY_ROOM_ADMIN_PIN --project lvz-rooms \
  --member "serviceAccount:$R_SA" --role roles/secretmanager.viewer --condition=None --quiet >/dev/null
trust_gate lvz-rooms "$R_SA" rooms-backend-release

say "Morning Prayer (lv-wm-prayer): gh-rules-deploy (Firestore rules only)"
P_SA="gh-rules-deploy@lv-wm-prayer.iam.gserviceaccount.com"
ensure_sa lv-wm-prayer gh-rules-deploy "GitHub Firestore rules release (Morning Prayer)"
project_role lv-wm-prayer "$P_SA" roles/firebaserules.admin
trust_gate lv-wm-prayer "$P_SA" prayer-rules-release

say "Read-only drift identities"
for spec in "lv-zion-duties us-central1 worship-functions-drift" "lvz-rooms us-west1 rooms-functions-drift"; do
  set -- $spec
  D_SA="gh-functions-drift@$1.iam.gserviceaccount.com"
  ensure_sa "$1" gh-functions-drift "GitHub Functions drift check (read-only)"
  project_role "$1" "$D_SA" roles/cloudfunctions.viewer
  sources_bucket_reader "$1" "$2" "$D_SA"
  trust_gate "$1" "$D_SA" "$3"
done

say "Artifact Registry cleanup policies"
cleanup_policy lv-zion-duties us-central1
cleanup_policy lvz-rooms us-west1

say "Check: roles held by the new accounts"
for pair in "lv-zion-duties $W_SA" "lvz-rooms $R_SA" "lv-wm-prayer $P_SA" "lv-zion-duties gh-functions-drift@lv-zion-duties.iam.gserviceaccount.com" "lvz-rooms gh-functions-drift@lvz-rooms.iam.gserviceaccount.com"; do
  set -- $pair
  echo "    $2:"
  gcloud projects get-iam-policy "$1" --flatten='bindings[].members' \
    --filter="bindings.members:serviceAccount:$2" --format='value(bindings.role)' | sed 's/^/      /'
done

PROVIDER_PREFIX="projects/$POOL_NUMBER/locations/global/workloadIdentityPools/$POOL/providers"
say "DONE. Paste these as GitHub repository VARIABLES (Settings, Secrets and variables, Actions, Variables tab):"
cat <<EOF

  worship-duty-app
    GCP_BACKEND_WIF_PROVIDER = $PROVIDER_PREFIX/worship-backend
    GCP_BACKEND_DEPLOY_SA    = $W_SA
    GCP_DRIFT_WIF_PROVIDER   = $PROVIDER_PREFIX/worship-drift
    GCP_DRIFT_SA             = gh-functions-drift@lv-zion-duties.iam.gserviceaccount.com

  study-room-scheduler
    GCP_BACKEND_WIF_PROVIDER = $PROVIDER_PREFIX/rooms-backend
    GCP_BACKEND_DEPLOY_SA    = $R_SA
    GCP_DRIFT_WIF_PROVIDER   = $PROVIDER_PREFIX/rooms-drift
    GCP_DRIFT_SA             = gh-functions-drift@lvz-rooms.iam.gserviceaccount.com

  morning-prayer-app
    GCP_RULES_WIF_PROVIDER   = $PROVIDER_PREFIX/prayer-rules
    GCP_RULES_DEPLOY_SA      = $P_SA

Or, from a terminal with the GitHub CLI signed in:
  gh variable set GCP_BACKEND_WIF_PROVIDER --repo $OWNER/worship-duty-app --body "$PROVIDER_PREFIX/worship-backend"
  gh variable set GCP_BACKEND_DEPLOY_SA    --repo $OWNER/worship-duty-app --body "$W_SA"
  gh variable set GCP_DRIFT_WIF_PROVIDER   --repo $OWNER/worship-duty-app --body "$PROVIDER_PREFIX/worship-drift"
  gh variable set GCP_DRIFT_SA             --repo $OWNER/worship-duty-app --body "gh-functions-drift@lv-zion-duties.iam.gserviceaccount.com"
  gh variable set GCP_BACKEND_WIF_PROVIDER --repo $OWNER/study-room-scheduler --body "$PROVIDER_PREFIX/rooms-backend"
  gh variable set GCP_BACKEND_DEPLOY_SA    --repo $OWNER/study-room-scheduler --body "$R_SA"
  gh variable set GCP_DRIFT_WIF_PROVIDER   --repo $OWNER/study-room-scheduler --body "$PROVIDER_PREFIX/rooms-drift"
  gh variable set GCP_DRIFT_SA             --repo $OWNER/study-room-scheduler --body "gh-functions-drift@lvz-rooms.iam.gserviceaccount.com"
  gh variable set GCP_RULES_WIF_PROVIDER   --repo $OWNER/morning-prayer-app --body "$PROVIDER_PREFIX/prayer-rules"
  gh variable set GCP_RULES_DEPLOY_SA      --repo $OWNER/morning-prayer-app --body "$P_SA"
EOF
