#!/usr/bin/env node
// One-time local setup (task P0-04). Works on Windows, macOS and Linux:
//   node scripts/dev-setup.mjs
// Checks the toolchain, creates .env, installs dependencies and starts the
// docker-compose services. Safe to run again.
import { execSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skipDocker = process.argv.includes('--skip-docker');

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

function step(message) {
  console.log(`\n▸ ${message}`);
}

function has(command) {
  try {
    execSync(command, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function run(command) {
  // Run through the shell so that .cmd shims (pnpm, docker) resolve on Windows.
  const result = spawnSync(command, { cwd: root, stdio: 'inherit', shell: true });
  if (result.status !== 0) fail(`"${command}" failed.`);
}

step('Checking Node.js');
const wantedMajor = readFileSync(join(root, '.nvmrc'), 'utf8').trim();
const actualMajor = process.versions.node.split('.')[0];
if (actualMajor !== wantedMajor) {
  fail(`Node.js ${wantedMajor}.x is required (.nvmrc); you are running ${process.versions.node}.`);
}
console.log(`  Node.js ${process.versions.node}`);

step('Checking pnpm');
if (!has('pnpm --version')) {
  fail(
    'pnpm is not on your PATH. Run "corepack enable" once (on Windows, from an administrator terminal), then run this script again.',
  );
}

step('Creating .env');
if (existsSync(join(root, '.env'))) {
  console.log('  .env already exists, left unchanged');
} else {
  copyFileSync(join(root, '.env.example'), join(root, '.env'));
  console.log('  copied .env.example to .env');
}

step('Installing dependencies');
run('pnpm install');

if (skipDocker) {
  console.log('\nSkipped docker-compose services (--skip-docker).');
} else {
  step('Starting local services (Postgres+PostGIS, Redis, OpenSearch, LocalStack, Mailpit)');
  if (!has('docker info')) {
    fail('Docker is not running. Start Docker Desktop, then run this script again.');
  }
  run('docker compose up -d --wait');
}

console.log(`
✔ Setup complete.
  pnpm dev          start web, api and worker in watch mode
  pnpm test         run all tests
  pnpm dev:down     stop the local services
  Mailpit inbox     http://localhost:8025 (or MAILPIT_UI_PORT from .env)
`);
