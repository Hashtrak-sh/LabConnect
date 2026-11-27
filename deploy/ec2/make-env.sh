#!/usr/bin/env bash
# Makes deploy/ec2/.env for the one-instance UAT (ADR-022): the public address, and a fresh,
# random value for every password and key. Run it once, on the server. It refuses to overwrite an
# existing .env, because new secrets would lock the running database out and end every session.
#
#   ./make-env.sh                         asks for the domain
#   ./make-env.sh uat.labconnect.example  HTTPS on that domain (its DNS must point at this server)
#   ./make-env.sh --ip                    plain HTTP on this server's public address (first test only)
#
# Prints the Mailpit password once; it is not stored anywhere in plain text.
set -euo pipefail
cd "$(dirname "$0")"

if [[ -e .env ]]; then
  echo "deploy/ec2/.env already exists. Delete it only if you mean to replace every secret." >&2
  exit 1
fi
for tool in openssl docker; do
  command -v "$tool" >/dev/null || { echo "$tool is needed (run setup-ec2.sh first)." >&2; exit 1; }
done

domain="${1:-}"
if [[ -z "$domain" ]]; then
  read -rp "Domain for UAT (leave empty for plain HTTP on this server's address): " domain
fi

if [[ -n "$domain" && "$domain" != "--ip" ]]; then
  if [[ ! "$domain" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]]; then
    echo "That is not a domain name: use lower case, like uat.labconnect.example." >&2
    exit 1
  fi
  site_address="$domain"
  web_origin="https://$domain"
  mail_from="LabConnect <no-reply@$domain>"
else
  # The instance's public address from the EC2 metadata service (IMDSv2); no outside call.
  token=$(curl -sf -X PUT http://169.254.169.254/latest/api/token \
    -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' || true)
  ip=$(curl -sf -H "X-aws-ec2-metadata-token: $token" \
    http://169.254.169.254/latest/meta-data/public-ipv4 || true)
  read -rp "Public address of this server [${ip:-none found}]: " typed
  ip="${typed:-$ip}"
  [[ -n "$ip" ]] || { echo "No address given." >&2; exit 1; }
  site_address=":80"
  web_origin="http://$ip"
  mail_from="LabConnect <no-reply@labconnect.local>"
fi

hex() { openssl rand -hex "$1"; }
# PKCS#8 PEM of a new Ed25519 key on one line, with \n between lines (the API reads it so).
jwt_key=$(openssl genpkey -algorithm ed25519 | awk 'BEGIN { ORS = "\\n" } { print }')
mailpit_password=$(openssl rand -base64 18 | tr -d '/+=')
mailpit_hash=$(docker run --rm caddy:2.10.0-alpine caddy hash-password --plaintext "$mailpit_password")

umask 077
cat > .env <<EOF
# Made by make-env.sh on $(date -u +%Y-%m-%dT%H:%MZ). Secrets: never commit or share this file.
SITE_ADDRESS=$site_address
WEB_ORIGIN=$web_origin
MAIL_FROM='$mail_from'

POSTGRES_USER=labconnect
POSTGRES_DB=labconnect
POSTGRES_PASSWORD=$(hex 24)
API_DB_USER=labconnect_api
API_DB_PASSWORD=$(hex 24)
WORKER_DB_USER=labconnect_worker
WORKER_DB_PASSWORD=$(hex 24)

AUTH_JWT_PRIVATE_KEY='$jwt_key'
AUTH_HASH_SECRET=$(hex 32)
AUTH_ENCRYPTION_KEY=$(hex 32)
PAYMENT_PAYLOAD_ENCRYPTION_KEY=$(hex 32)
PAYMENT_FAKE_WEBHOOK_SECRET=$(hex 32)

# No KMS on this server; nothing signs QR codes yet (I5). Recorded by the reference seed only.
QR_KEY_PLACEHOLDER=arn:aws:kms:ap-south-1:000000000000:key/uat-ec2-not-a-real-key

MAILPIT_USER=labconnect
MAILPIT_PASSWORD_HASH='$mailpit_hash'

# For \`docker compose run --rm migrate node dist/seed/cli.js platform-admin\` (README).
PLATFORM_ADMIN_EMAIL=
PLATFORM_ADMIN_NAME=
EOF

echo
echo "Wrote deploy/ec2/.env for $web_origin"
echo "Mailpit (every email UAT sends): $web_origin/mailpit/"
echo "  user: labconnect"
echo "  password: $mailpit_password"
echo "Keep that password somewhere safe; it is not shown again."
