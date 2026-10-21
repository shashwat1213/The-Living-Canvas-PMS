#!/usr/bin/env bash
# Wire the EXISTING Marketing Studio media bucket into Living Canvas PMS.
#
#   bash scripts/aws/setup-s3-media-bucket.sh            # validate only (default, read-only)
#   APPLY=1 bash scripts/aws/setup-s3-media-bucket.sh    # validate, then configure
#
# Does NOT create a bucket and does NOT create IAM users or access keys.
#
# Credential model (no long-lived keys anywhere):
#   - Production (Vercel): the function exchanges its Vercel OIDC token for
#     short-lived credentials of IAM role $ROLE_NAME
#     (sts:AssumeRoleWithWebIdentity). The trust policy accepts ONLY this
#     Vercel team + project + production environment.
#   - Local dev: the backend uses the default AWS credential chain, e.g.
#     AWS_PROFILE=ams (your own `aws login` session).
#
# APPLY=1 performs, idempotently:
#   1. CORS on the bucket (browser PUT/GET via presigned URLs from app origins)
#   2. Lifecycle rule: abort incomplete multipart uploads after 2 days
#   3. IAM OIDC identity provider for Vercel (if missing)
#   4. IAM role + inline least-privilege policy (Get/Put/Delete objects only)
#   5. Vercel production env: MEDIA_S3_BUCKET, MEDIA_S3_REGION, MEDIA_S3_ROLE_ARN
# It never touches Block Public Access or default encryption — those are only
# verified (and the script refuses to proceed if Block Public Access is off).
set -euo pipefail

PROFILE="${AWS_PROFILE_NAME:-ams}"
BUCKET="${MEDIA_BUCKET:-livingcanvas2026}"
REGION="${MEDIA_REGION:-ap-south-1}"
ROLE_NAME="${MEDIA_ROLE_NAME:-living-canvas-media-vercel}"
VERCEL_TEAM_SLUG="${VERCEL_TEAM_SLUG:-shashwatpatni1234-5315s-projects}"
VERCEL_PROJECT="${VERCEL_PROJECT:-living-canvas-pms}"
VERCEL_ENVIRONMENT="${VERCEL_ENVIRONMENT:-production}"
OIDC_HOST="oidc.vercel.com/${VERCEL_TEAM_SLUG}"
OIDC_AUD="https://vercel.com/${VERCEL_TEAM_SLUG}"
ORIGINS='["https://living-canvas-pms.vercel.app","http://localhost:5173","http://localhost:8080"]'
APPLY="${APPLY:-0}"

AWS=(aws --profile "$PROFILE")
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*"; FAILED=1; }
FAILED=0

echo "▶ Validating (profile=$PROFILE bucket=$BUCKET region=$REGION)"

# --- prerequisites -----------------------------------------------------------
command -v aws >/dev/null || { echo "aws CLI not found"; exit 1; }
if [[ "$APPLY" == "1" ]]; then command -v vercel >/dev/null || { echo "vercel CLI not found"; exit 1; }; fi

if ! IDENTITY_ARN="$("${AWS[@]}" sts get-caller-identity --query Arn --output text 2>/dev/null)"; then
  echo "  ✗ AWS session for profile '$PROFILE' is missing/expired — run: aws login --profile $PROFILE"
  exit 1
fi
ACCOUNT_ID="$("${AWS[@]}" sts get-caller-identity --query Account --output text)"
ok "caller: $IDENTITY_ARN (account $ACCOUNT_ID)"
if [[ "$IDENTITY_ARN" == *":root" ]]; then
  fail "you are signed in as the AWS ROOT user — use an IAM Identity Center / IAM admin identity instead"
fi

# --- bucket ------------------------------------------------------------------
if ! "${AWS[@]}" s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  fail "bucket '$BUCKET' not found or not accessible to this identity (need s3:ListBucket)"
  exit 1
fi
ok "bucket exists and is reachable"

ACTUAL_REGION="$("${AWS[@]}" s3api get-bucket-location --bucket "$BUCKET" --query LocationConstraint --output text)"
[[ "$ACTUAL_REGION" == "None" ]] && ACTUAL_REGION="us-east-1"
if [[ "$ACTUAL_REGION" == "$REGION" ]]; then ok "region $ACTUAL_REGION"; else fail "bucket region is $ACTUAL_REGION, expected $REGION"; fi

if BPA="$("${AWS[@]}" s3api get-public-access-block --bucket "$BUCKET" --query 'PublicAccessBlockConfiguration' --output json 2>/dev/null)"; then
  if [[ "$(tr -d ' \n' <<<"$BPA")" == *'"BlockPublicAcls":true'*'"IgnorePublicAcls":true'*'"BlockPublicPolicy":true'*'"RestrictPublicBuckets":true'* ]]; then
    ok "Block Public Access: all four settings ON"
  else
    fail "Block Public Access is not fully enabled on the bucket: $BPA"
  fi
else
  fail "no bucket-level Block Public Access configuration (or no s3:GetBucketPublicAccessBlock permission)"
fi

if ENC="$("${AWS[@]}" s3api get-bucket-encryption --bucket "$BUCKET" --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' --output text 2>/dev/null)"; then
  ok "default encryption: $ENC (left unchanged)"
  if [[ "$ENC" == "aws:kms" ]]; then
    warn "SSE-KMS: the role will also need kms:GenerateDataKey/kms:Decrypt on that key (not added automatically)"
  fi
else
  fail "could not read default encryption (need s3:GetEncryptionConfiguration)"
fi

if POLICY_STATUS="$("${AWS[@]}" s3api get-bucket-policy-status --bucket "$BUCKET" --query PolicyStatus.IsPublic --output text 2>/dev/null)"; then
  [[ "$POLICY_STATUS" == "False" ]] && ok "bucket policy is not public" || fail "bucket policy is PUBLIC"
else
  ok "no bucket policy (private)"
fi

OWNERSHIP="$("${AWS[@]}" s3api get-bucket-ownership-controls --bucket "$BUCKET" --query 'OwnershipControls.Rules[0].ObjectOwnership' --output text 2>/dev/null || echo unknown)"
[[ "$OWNERSHIP" == "BucketOwnerEnforced" ]] && ok "ACLs disabled (BucketOwnerEnforced)" || warn "object ownership: $OWNERSHIP (BucketOwnerEnforced recommended)"

if "${AWS[@]}" s3api get-bucket-cors --bucket "$BUCKET" >/dev/null 2>&1; then ok "CORS configured"; else warn "no CORS yet (needed for browser uploads)"; fi

# --- IAM ---------------------------------------------------------------------
OIDC_ARN="arn:aws:iam::${ACCOUNT_ID}:oidc-provider/${OIDC_HOST}"
if "${AWS[@]}" iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" >/dev/null 2>&1; then
  ok "Vercel OIDC provider registered"; HAVE_OIDC=1
else
  warn "Vercel OIDC provider not registered yet ($OIDC_HOST)"; HAVE_OIDC=0
fi
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
if "${AWS[@]}" iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then ok "role $ROLE_NAME exists"; else warn "role $ROLE_NAME not created yet"; fi

# Permission preflight for the APPLY steps (simulated; no changes made).
NEEDED=(s3:PutBucketCORS s3:PutLifecycleConfiguration iam:CreateOpenIDConnectProvider iam:CreateRole iam:PutRolePolicy iam:UpdateAssumeRolePolicy)
if [[ "$IDENTITY_ARN" == *":assumed-role/"* ]]; then
  SIM_ARN="arn:aws:iam::${ACCOUNT_ID}:role/$(cut -d/ -f2 <<<"$IDENTITY_ARN")"
else
  SIM_ARN="$IDENTITY_ARN"
fi
if SIM="$("${AWS[@]}" iam simulate-principal-policy --policy-source-arn "$SIM_ARN" --action-names "${NEEDED[@]}" \
      --query 'EvaluationResults[?EvalDecision!=`allowed`].EvalActionName' --output text 2>/dev/null)"; then
  if [[ -z "$SIM" || "$SIM" == "None" ]]; then ok "caller has all permissions needed for APPLY"; else fail "caller is missing: $SIM"; fi
else
  warn "could not simulate caller permissions (SSO permission sets often can't) — APPLY will report any AccessDenied"
fi

if [[ "$FAILED" == "1" ]]; then echo "✗ Validation failed — nothing changed."; exit 1; fi
if [[ "$APPLY" != "1" ]]; then echo "✓ Validation passed. Re-run with APPLY=1 to configure."; exit 0; fi

# =============================================================================
echo "▶ Applying"

"${AWS[@]}" s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration "{
  \"CORSRules\": [{
    \"AllowedOrigins\": $ORIGINS,
    \"AllowedMethods\": [\"GET\", \"PUT\", \"HEAD\"],
    \"AllowedHeaders\": [\"Content-Type\"],
    \"ExposeHeaders\": [\"ETag\"],
    \"MaxAgeSeconds\": 3600
  }]
}"
ok "CORS set for $ORIGINS"

"${AWS[@]}" s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration \
  '{"Rules":[{"ID":"abort-incomplete-multipart","Status":"Enabled","Filter":{},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":2}}]}'
ok "lifecycle: abort incomplete multipart uploads after 2 days"

if [[ "$HAVE_OIDC" == "0" ]]; then
  "${AWS[@]}" iam create-open-id-connect-provider --url "https://${OIDC_HOST}" --client-id-list "$OIDC_AUD" \
    --tags Key=app,Value=living-canvas-pms >/dev/null
  ok "registered Vercel OIDC provider https://${OIDC_HOST}"
fi

TRUST="{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Effect\": \"Allow\",
    \"Principal\": { \"Federated\": \"${OIDC_ARN}\" },
    \"Action\": \"sts:AssumeRoleWithWebIdentity\",
    \"Condition\": {
      \"StringEquals\": {
        \"${OIDC_HOST}:aud\": \"${OIDC_AUD}\",
        \"${OIDC_HOST}:sub\": \"owner:${VERCEL_TEAM_SLUG}:project:${VERCEL_PROJECT}:environment:${VERCEL_ENVIRONMENT}\"
      }
    }
  }]
}"
if "${AWS[@]}" iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  "${AWS[@]}" iam update-assume-role-policy --role-name "$ROLE_NAME" --policy-document "$TRUST"
  ok "role trust policy updated"
else
  "${AWS[@]}" iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document "$TRUST" --max-session-duration 3600 \
    --description "Living Canvas PMS (Vercel ${VERCEL_ENVIRONMENT}) media library access to s3://${BUCKET}" \
    --tags Key=app,Value=living-canvas-pms >/dev/null
  ok "role $ROLE_NAME created (trust: Vercel ${VERCEL_PROJECT}/${VERCEL_ENVIRONMENT} only)"
fi

"${AWS[@]}" iam put-role-policy --role-name "$ROLE_NAME" --policy-name media-objects --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Sid\": \"MediaObjects\",
    \"Effect\": \"Allow\",
    \"Action\": [\"s3:PutObject\", \"s3:GetObject\", \"s3:DeleteObject\"],
    \"Resource\": \"arn:aws:s3:::${BUCKET}/orgs/*\"
  }]
}"
ok "least-privilege policy: Get/Put/DeleteObject on s3://${BUCKET}/orgs/* only"

set_env() {
  vercel env rm "$1" "$VERCEL_ENVIRONMENT" -y >/dev/null 2>&1 || true
  printf '%s' "$2" | vercel env add "$1" "$VERCEL_ENVIRONMENT" >/dev/null
  ok "Vercel env $1 set"
}
set_env MEDIA_S3_BUCKET "$BUCKET"
set_env MEDIA_S3_REGION "$REGION"
set_env MEDIA_S3_ROLE_ARN "$ROLE_ARN"
# Remove any long-lived keys from an earlier approach.
vercel env rm MEDIA_S3_ACCESS_KEY_ID "$VERCEL_ENVIRONMENT" -y >/dev/null 2>&1 || true
vercel env rm MEDIA_S3_SECRET_ACCESS_KEY "$VERCEL_ENVIRONMENT" -y >/dev/null 2>&1 || true

echo "✅ Done. Redeploy (vercel deploy --prod) to activate S3 media storage."
