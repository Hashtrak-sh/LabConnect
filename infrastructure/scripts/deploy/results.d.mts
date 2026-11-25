export function judgeRunTask(output: unknown): string;
export function judgeMigrationTask(output: unknown): string;
export interface ExpectedRollout {
  service: string;
  taskDefinition: string;
}
export function judgeRollout(output: unknown, expected: ExpectedRollout): string;
export function imageExists(output: unknown): boolean;
export function readStackOutputs(output: unknown, keys: string[]): Record<string, string>;
export function healthUrl(base: unknown): string;
export function judgeHealth(status: number, body: string): string;
