export interface OpenSearchConfig {
  /** `OPENSEARCH_URL`, for example `http://localhost:9200`. */
  node: string;
  /** Only `none` (local, security plugin disabled) and `basic` are supported (OQ-156). */
  auth: { mode: 'none' } | { mode: 'basic'; username: string; password: string };
  /** The alias queries and writes go through. `lab_scope` (SEARCH.md section 1). */
  alias: string;
  /** The index behind the alias is `<alias>_v<version>`. */
  version: number;
  requestTimeoutMs: number;
}

export class OpenSearchConfigError extends Error {
  override name = 'OpenSearchConfigError';
}

/** The concrete index name: `lab_scope_v1`. */
export const indexName = (config: Pick<OpenSearchConfig, 'alias' | 'version'>): string =>
  `${config.alias}_v${String(config.version)}`;

/**
 * Reads the OpenSearch settings from the environment. Returns `null` when `OPENSEARCH_URL` is not
 * set: search then runs on Postgres alone and nothing in the process tries to reach a cluster.
 *
 * - `OPENSEARCH_AUTH_MODE`: `none` (default), `basic` (`OPENSEARCH_USERNAME`,
 *   `OPENSEARCH_PASSWORD`) or `aws`. `aws` is refused with a clear error: signing requests with
 *   SigV4 needs another dependency, so Amazon OpenSearch Service access is a documented gap
 *   (OQ-156) and a deployment that asks for it does not start with a half-working setup.
 * - `OPENSEARCH_INDEX_ALIAS` (default `lab_scope`), `OPENSEARCH_INDEX_VERSION` (default 1),
 *   `OPENSEARCH_TIMEOUT_MS` (default 1500).
 */
export function readOpenSearchConfig(
  env: Record<string, string | undefined> = process.env,
): OpenSearchConfig | null {
  const node = env.OPENSEARCH_URL?.trim();
  if (!node) return null;
  try {
    new URL(node);
  } catch {
    throw new OpenSearchConfigError('OPENSEARCH_URL is not a valid URL.');
  }
  const mode = env.OPENSEARCH_AUTH_MODE?.trim() || 'none';
  let auth: OpenSearchConfig['auth'];
  if (mode === 'none') {
    auth = { mode: 'none' };
  } else if (mode === 'basic') {
    const username = env.OPENSEARCH_USERNAME;
    const password = env.OPENSEARCH_PASSWORD;
    if (!username || !password) {
      throw new OpenSearchConfigError(
        'OPENSEARCH_AUTH_MODE=basic needs OPENSEARCH_USERNAME and OPENSEARCH_PASSWORD.',
      );
    }
    auth = { mode: 'basic', username, password };
  } else if (mode === 'aws') {
    throw new OpenSearchConfigError(
      'OPENSEARCH_AUTH_MODE=aws (SigV4) is not supported yet: it needs another dependency (OQ-156). Use none or basic.',
    );
  } else {
    throw new OpenSearchConfigError('OPENSEARCH_AUTH_MODE must be none, basic or aws.');
  }
  const alias = env.OPENSEARCH_INDEX_ALIAS?.trim() || 'lab_scope';
  if (!/^[a-z][a-z0-9_]{0,60}$/.test(alias)) {
    throw new OpenSearchConfigError(
      'OPENSEARCH_INDEX_ALIAS must be lower-case letters, digits and _.',
    );
  }
  return {
    node,
    auth,
    alias,
    version: positive(env.OPENSEARCH_INDEX_VERSION, 1, 'OPENSEARCH_INDEX_VERSION'),
    requestTimeoutMs: positive(env.OPENSEARCH_TIMEOUT_MS, 1500, 'OPENSEARCH_TIMEOUT_MS'),
  };
}

function positive(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new OpenSearchConfigError(`${name} must be a positive integer.`);
  }
  return value;
}
