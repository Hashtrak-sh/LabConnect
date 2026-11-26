import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';
import './globals.css';

export const metadata: Metadata = {
  title: t('app.name'),
  description: t('app.tagline'),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          {t('app.skipToContent')}
        </a>
        <p className="banner" role="note">
          {t('app.prototypeBanner')}
        </p>
        <header className="header">
          <div className="header-inner">
            <Link className="brand" href="/search">
              {t('app.name')}
            </Link>
            <nav aria-label="Main">
              <Link href="/search">{t('app.navSearch')}</Link>
            </nav>
          </div>
        </header>
        <main id="main" className="main">
          {children}
        </main>
      </body>
    </html>
  );
}
