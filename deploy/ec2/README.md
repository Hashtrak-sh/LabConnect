# UAT on one EC2 instance (prototype, ADR-022)

Everything runs with Docker Compose on a single EC2 instance, the way it runs on a developer
machine, with the API and the web app in containers too. It is the quick way to a shared UAT for
the v0.1 prototype. The AWS CDK stacks in `infrastructure/` (ECS, RDS, SES, ADR-015) stay the
target for the real UAT and production; nothing here changes them.

```
Internet ──► Caddy :80/:443 ──► web (Next.js) ──► api (NestJS) ──► postgres (PostGIS)
                  │                                    ├──► redis
                  └─ /mailpit (password) ──► mailpit ◄─┘ (every email, sign-in codes too)
```

Only Caddy is published. The API, the database and the rest are reachable only inside Docker.

## What you need

| Item | Suggestion |
|---|---|
| EC2 instance | **t3.large** (2 vCPU, 8 GB) or bigger, **Ubuntu 24.04**, 50 GB gp3 disk (30 GB filled up after a few updates), region ap-south-1 |
| Elastic IP | Attach one, so the address survives a stop and start |
| Security group | 22 from the developers' addresses only; **443 from the listed addresses only; 80 from everyone** (certificate challenge and redirect only, and renewal needs it): the table is in `DEMO.md` |
| Domain (required) | An A record, e.g. `uat.labconnect.<yours>` → the Elastic IP. The server runs HTTPS only; there is no plain-HTTP mode |
| Key pair | For SSH |

## First setup

1. Launch the instance as above and SSH in: `ssh -i <key>.pem ubuntu@<elastic-ip>`.
2. Get the code (a deploy key or a fine-grained read-only token for the private repository):
   ```bash
   git clone https://github.com/Hashtrak-sh/LabConnect.git && cd LabConnect
   git checkout <branch to test>
   ```
3. Install Docker and swap, then log out and in again:
   ```bash
   bash deploy/ec2/setup-ec2.sh && exit
   ```
4. Make the configuration (every password and key is random and new). It also asks for the access-gate
   password and the demo sign-in code (`DEMO.md`):
   ```bash
   cd LabConnect/deploy/ec2
   ./preflight.sh                           # Docker, memory, disk, ports
   ./make-env.sh uat.labconnect.example     # a domain whose A record points here
   ```
5. Build and start (the first build takes 10 to 20 minutes):
   ```bash
   ./up.sh                    # = docker compose up -d --build, with checks and a wait for health
   docker compose ps          # all healthy; migrate "exited (0)"
   ```
6. Optional, demo data (labs, scope, prices and demo users `…@demo.labconnect.test`):
   ```bash
   ./seed-demo.sh             # safe to run twice
   ```
7. Optional, the first platform administrator: set `PLATFORM_ADMIN_EMAIL` and `PLATFORM_ADMIN_NAME`
   in `.env`, then `docker compose run --rm migrate node dist/seed/cli.js platform-admin`.

Open `https://<domain>` (the browser asks for the gate's user name and password). Without a demo code,
sign-in codes arrive in Mailpit at `/mailpit/` (behind the same login): no email leaves the server.
For the demonstration (gate, firewall, demo code, checks, resets, limits): `DEMO.md`.

## Updating to newer code

```bash
cd ~/LabConnect && git pull
cd deploy/ec2 && ./update.sh     # builds first, then migrates and replaces; see DEMO.md
```

## Day to day

| Task | Command (in `deploy/ec2`) |
|---|---|
| Status | `docker compose ps` |
| Logs | `docker compose logs -f api web` |
| Restart one service | `docker compose restart api` |
| Stop everything | `docker compose down` (data stays in the volumes) |
| Database backup | `docker compose exec postgres pg_dump -U labconnect labconnect \| gzip > backup-$(date +%F).sql.gz` |
| Free disk space | `docker image prune -f` |

`docker compose down -v` **deletes the database**. Do not run it on a UAT people use.

## Not on this server yet

- **Real email.** Every email is caught by Mailpit; testers read their sign-in code there. Real
  delivery needs SES (verified sender, out of the sandbox, OQ-172, OQ-175).
- **The worker**: no outbox relay, notifications, file scanning or search sync. Nothing in I1 and
  I2 for customers needs it; the lab claim letterhead upload does (files, S3).
- **S3 and OpenSearch.** Search runs on PostgreSQL (as UAT on ECS would, OQ-176).
- **Backups and monitoring** are by hand (the table above). Take a snapshot of the EBS volume
  before risky changes.
- **Payments** use the fake gateway only (`APP_ENV=uat` allows it; OQ-133).
