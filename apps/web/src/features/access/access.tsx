import { Button, StatePanel } from '@labconnect/ui';
import { cookies } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cache } from 'react';
import { api } from '@/lib/api';
import { type MessageKey, t } from '@/lib/i18n';
import { ACCESS_COOKIE } from '@/lib/session';
import { type AccessUser, hasAnyRole, type RoleCode, toAccessUser } from './roles';

/** The text of a role, from `messages/en.json`. */
const ROLE_KEYS: Readonly<Record<RoleCode, MessageKey>> = {
  CUSTOMER_ADMIN: 'access.roles.CUSTOMER_ADMIN',
  CUSTOMER_REQUESTER: 'access.roles.CUSTOMER_REQUESTER',
  CUSTOMER_FINANCE: 'access.roles.CUSTOMER_FINANCE',
  LAB_MAKER: 'access.roles.LAB_MAKER',
  LAB_CHECKER: 'access.roles.LAB_CHECKER',
  PLATFORM_OPS: 'access.roles.PLATFORM_OPS',
  PLATFORM_DATA_STEWARD: 'access.roles.PLATFORM_DATA_STEWARD',
  PLATFORM_FINANCE: 'access.roles.PLATFORM_FINANCE',
  PLATFORM_ADMIN: 'access.roles.PLATFORM_ADMIN',
};

export function roleLabel(role: RoleCode): string {
  return t(ROLE_KEYS[role]);
}

export type Access =
  | { kind: 'ok'; user: AccessUser; token: string }
  | { kind: 'signed-out' }
  | { kind: 'unavailable' };

/**
 * The signed-in user from `GET /me`, once per request. The proxy has already refreshed the
 * access token for this request. 401 and 403 mean there is no usable session (also a partial
 * session, which only the enrolment page may use); anything else that is not a 200 is "the
 * service did not answer", which is not the same as signed out and is not shown as such.
 */
export const loadAccess = cache(async (): Promise<Access> => {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (token === undefined || token === '') return { kind: 'signed-out' };
  try {
    const { data, response } = await api(token).GET('/me');
    if (data) return { kind: 'ok', user: toAccessUser(data), token };
    if (response.status === 401 || response.status === 403) return { kind: 'signed-out' };
    return { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
});

/**
 * Board G3, session ended or never started. This is a page, not a redirect, on purpose: the
 * sign-in link is followed from this very page, so `proxy.ts` (which keeps the page to return to
 * from the `Referer` of a visit to /sign-in) stores this page's address in `lc_return`. A
 * server-side `redirect('/sign-in')` carries the `Referer` of the page *before* this one (or
 * none), so the user would come back to the wrong page. Nothing personal is in the address.
 */
export function SignInRequired() {
  return (
    <div className="mx-auto max-w-lg py-6">
      <h1 className="sr-only">{t('access.signInTitle')}</h1>
      <StatePanel
        kind="denied"
        title={t('access.signInTitle')}
        action={
          <Button asChild>
            <Link href="/sign-in">{t('access.signInAction')}</Link>
          </Button>
        }
      >
        <p>{t('access.signInText')}</p>
      </StatePanel>
    </div>
  );
}

/** Board G3, the role may not open this page. It names the roles, never any data of the page. */
export function AccessDenied({
  user,
  allowed,
}: {
  user: AccessUser;
  allowed: readonly RoleCode[];
}) {
  const needed = allowed.map(roleLabel).join(', ');
  const current = user.active?.roles.map(roleLabel).join(', ');
  return (
    <div className="mx-auto max-w-lg py-6">
      <h1 className="sr-only">{t('access.deniedTitle')}</h1>
      <StatePanel
        kind="denied"
        title={t('access.deniedTitle')}
        action={
          <Button asChild variant="secondary">
            <Link href="/">{t('access.backHome')}</Link>
          </Button>
        }
      >
        <p>
          {current === undefined
            ? t('access.deniedNoRole', { needed })
            : t('access.deniedText', { needed, current })}
        </p>
        <p>{t('access.deniedHelp')}</p>
      </StatePanel>
    </div>
  );
}

function Unavailable() {
  return (
    <div className="mx-auto max-w-lg py-6">
      <h1 className="sr-only">{t('access.unavailableTitle')}</h1>
      <StatePanel
        kind="error"
        title={t('access.unavailableTitle')}
        action={
          <Button asChild variant="secondary">
            <Link href="/">{t('access.backHome')}</Link>
          </Button>
        }
      >
        <p>{t('access.unavailableText')}</p>
      </StatePanel>
    </div>
  );
}

export type Gate = { ok: true; user: AccessUser; token: string } | { ok: false; panel: ReactNode };

/**
 * For a page: the signed-in user (with one of `allowed`, when given), or the panel to render
 * instead of the page: "sign in" (G3), "no access" (G3) or "service unavailable". Pages return
 * the panel, so no part of the page runs for someone who may not see it.
 */
export async function gate(allowed?: readonly RoleCode[]): Promise<Gate> {
  const access = await loadAccess();
  if (access.kind === 'signed-out') return { ok: false, panel: <SignInRequired /> };
  if (access.kind === 'unavailable') return { ok: false, panel: <Unavailable /> };
  if (allowed !== undefined && !hasAnyRole(access.user, allowed)) {
    return { ok: false, panel: <AccessDenied user={access.user} allowed={allowed} /> };
  }
  return { ok: true, user: access.user, token: access.token };
}

export type ActionGate =
  | { ok: true; user: AccessUser; token: string }
  | { ok: false; reason: 'signed-out' | 'forbidden' | 'unavailable' };

/**
 * For a server action: the same check, as data. An action is an entry point of its own (a POST
 * anyone can send), so it never relies on the page having been gated.
 */
export async function actionGate(allowed?: readonly RoleCode[]): Promise<ActionGate> {
  const access = await loadAccess();
  if (access.kind === 'signed-out') return { ok: false, reason: 'signed-out' };
  if (access.kind === 'unavailable') return { ok: false, reason: 'unavailable' };
  if (allowed !== undefined && !hasAnyRole(access.user, allowed))
    return { ok: false, reason: 'forbidden' };
  return { ok: true, user: access.user, token: access.token };
}
