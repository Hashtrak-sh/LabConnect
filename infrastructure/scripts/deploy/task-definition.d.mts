export const READ_ONLY_FIELDS: string[];
export function replaceImageTag(image: unknown, tag: unknown): string;
export function repositoryOf(image: string): string;
export interface BuildOptions {
  container: string;
  tag: string;
  repository?: string;
}
export function buildRegisterInput(
  described: unknown,
  options: BuildOptions,
): Record<string, unknown>;
