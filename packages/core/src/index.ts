// Server-side code shared by apps/api and apps/worker, organised by module folder
// (ADR-020). Nest-free: the apps wrap it in providers.
export * from './platform/index.js';
