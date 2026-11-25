// The infrastructure package is linted on its own (`pnpm --filter @labconnect/infrastructure lint`,
// part of the root `pnpm lint`) with the repository's shared rules. The root eslint.config.mjs
// ignores this folder: type-aware linting loads the whole of aws-cdk-lib's type definitions,
// and together with the other projects that goes over Node's default heap limit.
import base from '@labconnect/config/eslint';

export default base;
