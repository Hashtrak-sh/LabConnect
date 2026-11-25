import { execFileSync } from 'node:child_process';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Base URL of the OpenSearch node the OpenSearch suite runs against. */
    opensearchUrl: string;
  }
}

const IMAGE = 'opensearchproject/opensearch:3.10.0';
const CONTAINER = `lc-os-test-${String(process.pid)}`;
const STARTUP_TIMEOUT_MS = 180_000;

const docker = (...args: string[]): string =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function waitUntilGreen(url: string): Promise<void> {
  const deadline = performance.now() + STARTUP_TIMEOUT_MS;
  for (;;) {
    try {
      const response = await fetch(`${url}/_cluster/health`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    if (performance.now() > deadline) {
      throw new Error(`OpenSearch did not become healthy within ${String(STARTUP_TIMEOUT_MS)} ms.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

/**
 * The OpenSearch suite (`pnpm --filter @labconnect/core test:opensearch`, not part of CI). It
 * uses `OPENSEARCH_TEST_URL` when set (an OpenSearch you already run; it creates and deletes
 * only indexes named `lc_test_*`). Otherwise it starts the image of docker-compose.yml with
 * `docker run` on a free port, with the security plugin off like the local stack, and removes
 * the container when the run ends. Needs Docker and the image (about 2.9 GB, once).
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const given = process.env.OPENSEARCH_TEST_URL;
  if (given) {
    project.provide('opensearchUrl', given.replace(/\/$/, ''));
    return () => Promise.resolve();
  }
  docker(
    'run',
    '-d',
    '--rm',
    '--name',
    CONTAINER,
    '-p',
    '127.0.0.1::9200',
    '-e',
    'discovery.type=single-node',
    '-e',
    'DISABLE_SECURITY_PLUGIN=true',
    '-e',
    'DISABLE_INSTALL_DEMO_CONFIG=true',
    '-e',
    'OPENSEARCH_JAVA_OPTS=-Xms512m -Xmx512m',
    IMAGE,
  );
  try {
    const mapping = docker('port', CONTAINER, '9200/tcp').split('\n')[0] ?? '';
    const port = mapping.slice(mapping.lastIndexOf(':') + 1);
    const url = `http://127.0.0.1:${port}`;
    await waitUntilGreen(url);
    project.provide('opensearchUrl', url);
  } catch (error) {
    try {
      docker('rm', '-f', CONTAINER);
    } catch {
      // already gone
    }
    throw error;
  }
  return () => {
    try {
      docker('rm', '-f', CONTAINER);
    } catch {
      // already gone
    }
    return Promise.resolve();
  };
}
