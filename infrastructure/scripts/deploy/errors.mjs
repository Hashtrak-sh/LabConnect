/** A deployment check failed: the message says why and never contains a secret. The CLI exits 1. */
export class DeployCheckError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DeployCheckError';
  }
}
