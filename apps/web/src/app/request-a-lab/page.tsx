import { Card } from '@labconnect/ui';
import type { Metadata } from 'next';
import { LeadForm } from '@/features/discovery/LeadForm';
import {
  leadCriteria,
  pageHref,
  readSearchForm,
  toSearchLabsParams,
} from '@/features/discovery/search-params';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';

export const metadata: Metadata = { title: `${t('lead.titleNoResult')} · ${t('app.name')}` };

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Request a lab (board H3), from two entry points: "Request this lab" on a listed lab (`?lab=`)
 * and "Request a lab" after a search with no results (the search, never the location, in the
 * query). The search text is filled in for the user.
 */
export default async function RequestALabPage({ searchParams }: Props) {
  const raw = await searchParams;
  const form = readSearchForm(raw);
  const labId = typeof raw.lab === 'string' && UUID.test(raw.lab) ? raw.lab : null;
  const lab =
    labId === null
      ? null
      : await api()
          .GET('/public/lab-sites/{siteId}', { params: { path: { siteId: labId } } })
          .then(({ data }) => data ?? null)
          .catch(() => null);

  const text = {
    whatLabel: lab === null ? t('lead.whatLabelNoResult') : t('lead.whatLabel'),
    whatHelp: t('lead.whatHelp'),
    emailLabel: t('lead.emailLabel'),
    emailHelp: t('lead.emailHelp'),
    required: t('lead.required'),
    submit: t('lead.submit'),
    sending: t('lead.sending'),
    cancel: t('lead.cancel'),
    sentTitle: t('lead.sentTitle'),
    sentText: t('lead.sentText'),
    errorEmail: t('lead.errorEmail'),
    errorWhat: t('lead.errorWhat'),
    failed: t('lead.failed'),
    rateLimited: t('lead.rateLimited'),
    labNotFound: t('lead.labNotFound'),
  };
  const criteria = leadCriteria(toSearchLabsParams(form, null, '', 1)) ?? {};
  delete criteria.q;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 py-4">
      <h1 className="text-2xl font-bold text-text">
        {lab === null ? t('lead.titleNoResult') : t('lead.titleLab')}
      </h1>
      <p className="text-text-muted">
        {lab === null ? t('lead.introNoResult') : t('lead.introLab', { lab: lab.name })}
      </p>
      <Card className="p-5">
        <LeadForm
          kind={lab === null ? 'NO_RESULT' : 'REQUEST_LAB'}
          {...(lab === null ? { criteria } : { labSiteId: lab.id })}
          initialWhat={form.q}
          cancelHref={lab === null ? pageHref(form, null) : `/labs/${lab.id}`}
          text={text}
        />
      </Card>
    </div>
  );
}
