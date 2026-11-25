export interface LoginSpec {
  userVariable: string;
  passwordVariable: string;
  role: string;
}
export interface LoginUser {
  user: string;
  password: string;
  role: string;
}
export interface QueryClient {
  query(text: string, values?: unknown[]): Promise<{ rows: { sql?: string }[] }>;
}
export const LOGIN_SPECS: LoginSpec[];
export function readLoginUsers(env: Record<string, string | undefined>): LoginUser[];
export function createLoginUsers(client: QueryClient, users: LoginUser[]): Promise<string[]>;
