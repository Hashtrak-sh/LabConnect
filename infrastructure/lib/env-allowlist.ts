/**
 * Variables of `.env.example` that the deployed task definitions deliberately do not set.
 * `test/runtime-env.test.ts` fails when `.env.example` gains a variable that is neither set
 * on a task definition (compute-stack.ts) nor listed here with a reason, so a new variable
 * cannot be forgotten. It also fails for an entry here that is no longer in `.env.example`
 * or that a task definition does set after all.
 */
export const NOT_SET_IN_UAT: Record<string, string> = {
  // docker-compose.yml only
  POSTGRES_USER: 'local container setting (docker-compose.yml)',
  POSTGRES_PASSWORD: 'local container setting (docker-compose.yml)',
  POSTGRES_DB: 'local container setting (docker-compose.yml)',
  POSTGRES_PORT: 'local container port',
  REDIS_PORT: 'local container port',
  OPENSEARCH_PORT: 'local container port',
  LOCALSTACK_PORT: 'local container port',
  MAILPIT_SMTP_PORT: 'local container port',
  MAILPIT_UI_PORT: 'local container port',
  // nothing reads it
  REDIS_URL:
    'no code reads it today, so UAT has no Redis (throttles are in the application: see README)',
  // replaced by the task role and the real AWS endpoints
  AWS_ENDPOINT_URL: 'LocalStack only; real endpoints in UAT',
  AWS_ACCESS_KEY_ID: 'no access keys: the task roles provide credentials',
  AWS_SECRET_ACCESS_KEY: 'no access keys: the task roles provide credentials',
  FILES_S3_ENDPOINT: 'LocalStack only',
  FILES_S3_FORCE_PATH_STYLE: 'LocalStack only',
  FILES_S3_SSE_KMS: 'local emulators only: SSE-KMS stays on (the default)',
  FILES_DEV_AUTO_SCAN: 'development and test only: the worker refuses it when deployed',
  // mail: the worker and the API (sign-in code) both send through SES
  SMTP_HOST: 'Mailpit only; no SMTP server exists in UAT (the API and the worker use SES)',
  SMTP_PORT: 'Mailpit only; no SMTP server exists in UAT (the API and the worker use SES)',
  // set by hand when the platform administrator is seeded, never in a task definition
  PLATFORM_ADMIN_EMAIL: 'given when seed:platform-admin is run (README: One-time setup)',
  PLATFORM_ADMIN_NAME: 'given when seed:platform-admin is run (README: One-time setup)',
  // only while a signing key is being replaced
  AUTH_JWT_PREVIOUS_PUBLIC_KEY:
    'only during a signing-key rotation (README: Rotating the signing key)',
  AUTH_JWT_PREVIOUS_KEY_ID: 'only during a signing-key rotation (README: Rotating the signing key)',
  // the application's own defaults are right for UAT
  AUTH_JWT_ISSUER: 'application default (labconnect-api)',
  AUTH_JWT_AUDIENCE: 'application default (labconnect)',
  OUTBOX_RELAY_INTERVAL_MS: 'tuning; application default',
  OUTBOX_RELAY_BATCH_SIZE: 'tuning; application default',
  AUDIT_SEAL_INTERVAL_MS: 'tuning; application default',
  AUDIT_SEAL_BATCH_SIZE: 'tuning; application default',
  AUDIT_VERIFY_INTERVAL_MS: 'tuning; application default',
  TIMER_POLL_INTERVAL_MS: 'tuning; application default',
  TIMER_BATCH_SIZE: 'tuning; application default',
  FILES_POLL_INTERVAL_MS: 'tuning; application default',
  FILES_POLL_BATCH_SIZE: 'tuning; application default',
  PAYMENT_EVENTS_POLL_INTERVAL_MS: 'tuning; application default',
  PAYMENT_EVENTS_BATCH_SIZE: 'tuning; application default',
  NOTIFICATIONS_POLL_INTERVAL_MS: 'tuning; application default',
  NOTIFICATIONS_POLL_BATCH_SIZE: 'tuning; application default',
  EMAIL_POLL_INTERVAL_MS: 'tuning; application default',
  EMAIL_BATCH_SIZE: 'tuning; application default',
  EMAIL_MAX_ATTEMPTS: 'tuning; application default',
  OPENSEARCH_INDEX_ALIAS: 'application default; only read when OpenSearch is on',
  OPENSEARCH_INDEX_VERSION: 'application default; only read when OpenSearch is on',
  OPENSEARCH_TIMEOUT_MS: 'application default; only read when OpenSearch is on',
  SEARCH_POLL_INTERVAL_MS: 'application default; only read when OpenSearch is on',
  SEARCH_POLL_BATCH_SIZE: 'application default; only read when OpenSearch is on',
  SEARCH_REINDEX_INTERVAL_MS: 'application default; only read when OpenSearch is on',
  SEARCH_REINDEX_BATCH_SIZE: 'application default; only read when OpenSearch is on',
  // demo one-time codes: off by default, set on the API task only by the demoOtpCode context
  DEMO_OTP_CODE:
    'UAT demonstrations only: set on the API task only when the demoOtpCode context is given (README: Demo one-time codes)',
  DEMO_OTP_EMAIL_DOMAIN:
    'UAT demonstrations only: set on the API task only when the demoOtpCode context is given (README: Demo one-time codes)',
  // tests
  OPENSEARCH_TEST_URL: 'test suites only',
};
