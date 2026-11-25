# syntax=docker/dockerfile:1
#
# Images of the LabConnect services (docs/07-operations/AWS_ENVIRONMENTS_AND_DEPLOYMENT.md,
# docs/06-engineering/CI_CD.md). One file, one target per image:
#
#   docker build --target api     -t labconnect/api:<tag> .
#   docker build --target worker  -t labconnect/worker:<tag> .
#   docker build --target migrate -t labconnect/migrate:<tag> .
#
# The web app is not built here: apps/web is still a skeleton. All images run as the
# unprivileged `node` user and contain no secrets: configuration comes from the task
# definition (infrastructure/lib/stacks/compute-stack.ts).

ARG NODE_IMAGE=node:24-bookworm-slim

# ---- the RDS certificate authority bundle, so the database connection is verified
FROM ${NODE_IMAGE} AS rds-ca
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
      --output /rds-global-bundle.pem \
      https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
    && grep -c 'BEGIN CERTIFICATE' /rds-global-bundle.pem

# ---- build: install, generate, compile
FROM ${NODE_IMAGE} AS build
RUN npm install --global pnpm@12.23.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
      --filter "@labconnect/api..." \
      --filter "@labconnect/worker..." \
      --filter "@labconnect/database..."
RUN pnpm db:generate \
    && pnpm contract:generate \
    && pnpm --filter "@labconnect/api..." --filter "@labconnect/worker..." run build

# ---- production dependencies only, per service
FROM build AS api-bundle
RUN pnpm --filter @labconnect/api deploy --prod --legacy /bundle

FROM build AS worker-bundle
RUN pnpm --filter @labconnect/worker deploy --prod --legacy /bundle

# ---- shared runtime base: non-root, trusts the RDS CA
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    NODE_EXTRA_CA_CERTS=/etc/ssl/rds-global-bundle.pem
COPY --from=rds-ca /rds-global-bundle.pem /etc/ssl/rds-global-bundle.pem
WORKDIR /app

FROM runtime AS api
COPY --from=api-bundle --chown=node:node /bundle /app
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]

FROM runtime AS worker
COPY --from=worker-bundle --chown=node:node /bundle /app
USER node
CMD ["node", "dist/main.js"]

# ---- one-off: prisma migrate deploy, the login users, the reference seed.
# Runs as the schema owner. It carries the build tools (the Prisma CLI is a development
# dependency of the database package), which is why it is a separate image.
FROM build AS migrate
# The Prisma schema engine uses the system trust store, so the RDS bundle goes in there too.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=rds-ca /rds-global-bundle.pem /usr/local/share/ca-certificates/rds-global-bundle.crt
RUN update-ca-certificates
ENV NODE_ENV=production \
    NODE_EXTRA_CA_CERTS=/etc/ssl/rds-global-bundle.pem
COPY --from=rds-ca /rds-global-bundle.pem /etc/ssl/rds-global-bundle.pem
COPY infrastructure/scripts/create-login-users.mjs /app/packages/database/create-login-users.mjs
# Fetch the Prisma schema engine now instead of on the first run in AWS.
RUN cd packages/database && ./node_modules/.bin/prisma version
RUN chown -R node:node /app
USER node
WORKDIR /app/packages/database
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node create-login-users.mjs && node dist/seed/cli.js reference"]
