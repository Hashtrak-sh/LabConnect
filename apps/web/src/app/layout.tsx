import { Alert, Button } from '@labconnect/ui';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { currentUser } from '@/features/auth/current-user';
import { signOutAction } from '@/features/auth/sign-in-actions';
import { t } from '@/lib/i18n';
import './globals.css';

export const metadata: Metadata = {
  title: t('app.name'),
  description: t('home.intro'),
};

/** Set by the proxy for a minute when a refresh was refused (proxy.ts). */
const SESSION_ENDED_COOKIE = 'lc_session_ended';

/**
 * The shell of boards H1 and B1: top bar with the product name, "Find a lab", the account area
 * (G1: "Sign in", or the signed-in user with "Sign out") and the "Provisional brand" tag (OQ-19);
 * main landmark with a skip link; footer. G3's "Your session has ended" shows once after a
 * refused refresh. "Verify a report" and the lab entry are left out until those pages exist.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  const sessionEnded = user === null && (await cookies()).get(SESSION_ENDED_COOKIE) !== undefined;
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-bg">
        <a
          href="#main"
          className="sr-only rounded-md bg-surface-raised px-3 py-2 focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
        >
          {t('app.skipToContent')}
        </a>
        <header className="border-b border-border bg-surface-raised">
          <div className="mx-auto flex min-h-16 w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 md:px-8">
            <Link
              href="/"
              className="text-lg font-bold tracking-tight text-brand-secondary no-underline"
            >
              {t('app.name')}
            </Link>
            <nav aria-label={t('app.navLabel')} className="flex gap-1">
              <Link
                href="/search"
                className="rounded-md px-3 py-2 text-sm font-medium text-text-subtle no-underline hover:bg-brand-tint hover:text-brand-on-tint"
              >
                {t('app.navFindLab')}
              </Link>
            </nav>
            <div className="ml-auto flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-dashed border-warning bg-warning-bg px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-warning-strong">
                {t('app.provisionalBrand')}
              </span>
              {user === null ? (
                <Button asChild variant="secondary">
                  <Link href="/sign-in">{t('auth.signIn')}</Link>
                </Button>
              ) : (
                <div
                  aria-label={t('auth.accountMenu')}
                  role="group"
                  className="flex flex-wrap items-center gap-3"
                >
                  <p className="text-sm text-text">
                    <span className="sr-only">{t('auth.signedInAs', { name: '' })}</span>
                    <span className="font-medium">{user.name}</span>
                    {user.organisation !== null && (
                      <span className="text-text-muted"> · {user.organisation}</span>
                    )}
                  </p>
                  <form action={signOutAction}>
                    <Button type="submit" variant="secondary">
                      {t('auth.signOut')}
                    </Button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8">
          {sessionEnded && (
            <Alert tone="warning" title={t('auth.sessionEndedTitle')} className="mb-6">
              <p>{t('auth.sessionEnded')}</p>
              <Link href="/sign-in">{t('auth.signInAgain')}</Link>
            </Alert>
          )}
          {children}
        </main>
        <footer className="border-t border-border bg-neutral-bg">
          <p className="mx-auto w-full max-w-7xl px-4 py-4 text-sm text-text-subtle md:px-8">
            {t('app.footer')}
          </p>
        </footer>
      </body>
    </html>
  );
}
