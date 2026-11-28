#!/usr/bin/env bash
# Makes deploy/ec2/.env for the one-instance UAT (ADR-022): the public address, and a fresh,
# random value for every password and key. Run it once, on the server. It refuses to overwrite an
# existing .env, because new secrets would lock the running database out and end every session.
#
#   ./make-env.sh                         asks for the domain
#   ./make-env.sh uat.labconnect.example  HTTPS on that domain (its DNS must point at this server)
#   ./make-env.sh --local                 LOCAL VERIFICATION on a developer machine only:
#                                         uat.localhost, Caddy's own certificate, ports 58080/58443
#
# The site is behind a shared user name and password (the access gate, on by default). It asks for
# them: GATE_USER (default demo) and the password, typed hidden or taken from GATE_PASSWORD in the
# environment (not the command line: that stays in the shell history). An empty password is
# generated and written to .gate-password (owner only; read it, hand it out, delete it): it is
# never printed. ACCESS_GATE=off turns the gate off, on purpose and with a warning.
# DEMO_OTP_CODE (six digits; empty = no demo code) is the fixed sign-in code of the demo accounts.
set -euo pipefail
cd "$(dirname "$0")"

if [[ -e .env ]]; then
  echo "deploy/ec2/.env already exists. Delete it only if you mean to replace every secret." >&2
  exit 1
fi
for tool in openssl docker; do
  command -v "$tool" >/dev/null || { echo "$tool is needed (run setup-ec2.sh first)." >&2; exit 1; }
done

local_mode=no
domain=""
for arg in "$@"; do
  case "$arg" in
    --local) local_mode=yes ;;
    -*) echo "Unknown option $arg. The plain-HTTP mode (--ip) no longer exists: the server has a domain." >&2; exit 1 ;;
    *) domain="$arg" ;;
  esac
done

if [[ "$local_mode" == yes ]]; then
  domain="${domain:-uat.localhost}"
  [[ "$domain" == *.localhost ]] || { echo "--local needs a *.localhost name, not $domain." >&2; exit 1; }
  tls_mode=internal
  http_port=58080
  https_port=58443
  web_origin="https://$domain:$https_port"
  echo "############################################################################" >&2
  echo "# LOCAL VERIFICATION MODE: Caddy's own certificate, ports $http_port and $https_port. #" >&2
  echo "# This is not a deployment.                                                #" >&2
  echo "############################################################################" >&2
else
  if [[ -z "$domain" ]]; then
    read -rp "Domain for UAT (its DNS A record must already point at this server): " domain
  fi
  if [[ ! "$domain" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ || "$domain" != *.* ]]; then
    echo "That is not a domain name: use lower case with a dot, like uat.labconnect.example." >&2
    exit 1
  fi
  if [[ "$domain" =~ ^[0-9.]+$ ]]; then
    echo "An IP address cannot get a certificate: the server needs a domain name." >&2
    exit 1
  fi
  if [[ "$domain" == *.localhost || "$domain" == localhost ]]; then
    echo "A .localhost name is for --local only." >&2
    exit 1
  fi
  tls_mode=auto
  http_port=80
  https_port=443
  web_origin="https://$domain"
fi
site_address="$domain"
if [[ "$local_mode" == yes ]]; then
  mail_from="LabConnect <no-reply@labconnect.local>"
else
  mail_from="LabConnect <no-reply@$domain>"
fi

demo_code="${DEMO_OTP_CODE-}"
if [[ -z "$demo_code" && -t 0 && -z "${DEMO_OTP_CODE+x}" ]]; then
  read -rp "Six-digit demo sign-in code (empty = no demo code) [444444]: " demo_code
  demo_code="${demo_code:-444444}"
fi
if [[ -n "$demo_code" && ! "$demo_code" =~ ^[0-9]{6}$ ]]; then
  echo "The demo code must be exactly six digits." >&2
  exit 1
fi

access_gate="${ACCESS_GATE:-on}"
[[ "$access_gate" == on || "$access_gate" == off ]] || { echo "ACCESS_GATE must be on or off." >&2; exit 1; }
gate_user="${GATE_USER:-demo}"
[[ "$gate_user" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "GATE_USER: letters, digits, . _ - only." >&2; exit 1; }
gate_password="${GATE_PASSWORD:-}"
generated_gate_password=no
if [[ "$access_gate" == on ]]; then
  if [[ -z "$gate_password" ]]; then
    if [[ -t 0 ]]; then
      read -rsp "Password of the access gate (hidden; empty = generate one into .gate-password): " gate_password
      echo >&2
    fi
    if [[ -z "$gate_password" ]]; then
      gate_password=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)
      generated_gate_password=yes
    fi
  fi
  [[ ${#gate_password} -ge 12 ]] || { echo "The gate password needs at least 12 characters." >&2; exit 1; }
else
  echo "WARNING: ACCESS_GATE=off. Anyone who reaches port 443 can sign in as the demo accounts." >&2
fi

hex() { openssl rand -hex "$1"; }
# PKCS#8 PEM of a new Ed25519 key on one line, with \n between lines (the API reads it so).
jwt_key=$(openssl genpkey -algorithm ed25519 | awk 'BEGIN { ORS = "\\n" } { print }')
mailpit_password=$(openssl rand -base64 18 | tr -d '/+=')
# The passwords go to Caddy through standard input, not the command line (a process list shows that).
mailpit_hash=$(printf '%s\n' "$mailpit_password" | docker run --rm -i caddy:2.10.0-alpine caddy hash-password | tr -d '\r\n')
gate_hash=""
if [[ "$access_gate" == on ]]; then
  gate_hash=$(printf '%s\n' "$gate_password" | docker run --rm -i caddy:2.10.0-alpine caddy hash-password | tr -d '\r\n')
fi
for h in "$mailpit_hash" "$gate_hash"; do
  [[ -z "$h" || "$h" == '$2'* ]] || { echo "Caddy did not return a bcrypt hash." >&2; exit 1; }
done

umask 077
if [[ "$generated_gate_password" == yes ]]; then
  printf '%s\n' "$gate_password" > .gate-password
fi
cat > .env <<EOF
# Made by make-env.sh on $(date -u +%Y-%m-%dT%H:%MZ). Secrets: never commit or share this file.
SITE_ADDRESS=$site_address
WEB_ORIGIN=$web_origin
MAIL_FROM='$mail_from'

# The proxy: auto = a public certificate; internal = LOCAL VERIFICATION only (a *.localhost name).
TLS_MODE=$tls_mode
HTTP_PORT=$http_port
HTTPS_PORT=$https_port

# The access gate: on (default) or off. Only the hash of the password is stored.
ACCESS_GATE=$access_gate
GATE_USER=$gate_user
GATE_PASSWORD_HASH='$gate_hash'

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

# Demo one-time codes: the API's sign-in and lab-claim codes of the demo accounts are this fixed
# code and are not mailed. The line is absent when there is no demo code (the API refuses a
# variable that is present but empty). DEMO_OTP_EMAIL_DOMAIN is optional (default
# demo.labconnect.test, must end in .test, .example, .invalid or .localhost).
$([[ -n "$demo_code" ]] && echo "DEMO_OTP_CODE=$demo_code" || echo "# DEMO_OTP_CODE=")
# DEMO_OTP_EMAIL_DOMAIN=demo.labconnect.test

# For \`docker compose run --rm migrate node dist/seed/cli.js platform-admin\` (README).
PLATFORM_ADMIN_EMAIL=
PLATFORM_ADMIN_NAME=
EOF

echo
echo "Wrote deploy/ec2/.env for $web_origin"
if [[ "$access_gate" == on ]]; then
  echo "Access gate: ON, user '$gate_user'."
  if [[ "$generated_gate_password" == yes ]]; then
    echo "  The password was generated into deploy/ec2/.gate-password (owner only, not printed)."
    echo "  Read it once, hand it to the people who may see the demonstration, then delete the file."
  fi
  echo "Mailpit (every email UAT sends): $web_origin/mailpit/ with the same login."
else
  echo "Access gate: OFF."
  echo "Mailpit (every email UAT sends): $web_origin/mailpit/"
  echo "  user: labconnect"
  echo "  password: $mailpit_password"
  echo "Keep that password somewhere safe; it is not shown again."
fi
if [[ -n "$demo_code" ]]; then
  echo "Demo sign-in code: set (the demo accounts sign in with it; see deploy/ec2/DEMO.md)."
else
  echo "Demo sign-in code: not set; sign-in codes arrive in Mailpit."
fi
