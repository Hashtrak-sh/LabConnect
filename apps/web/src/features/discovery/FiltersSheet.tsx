'use client';

import { Button, Modal } from '@labconnect/ui';
import { SlidersHorizontal } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

interface Props {
  labels: { open: string; title: string; close: string; apply: string; clear: string };
  /** Where "Clear all" goes: the same search without filters. */
  clearHref: string;
  /** Hidden inputs that keep the current search text and radius. */
  keep: ReactNode;
  /** The filter fields. */
  children: ReactNode;
}

/**
 * Filters below 1024 px (board H2): a side sheet at tablet width, a bottom sheet on phones, with
 * "Clear all" and "Show labs". On wide screens the filters sit inline instead.
 */
export function FiltersSheet({ labels, clearHref, keep, children }: Props) {
  const [placement, setPlacement] = useState<'bottom' | 'side'>('bottom');
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)');
    const update = (): void => {
      setPlacement(query.matches ? 'side' : 'bottom');
    };
    update();
    query.addEventListener('change', update);
    return () => {
      query.removeEventListener('change', update);
    };
  }, []);

  return (
    <Modal
      placement={placement}
      title={labels.title}
      closeLabel={labels.close}
      trigger={
        <Button type="button" variant="secondary" className="lg:hidden">
          <SlidersHorizontal aria-hidden="true" className="size-4" />
          {labels.open}
        </Button>
      }
    >
      <form action="/search" method="get" className="flex flex-col gap-4">
        {keep}
        {children}
        <div className="flex gap-2 pt-2">
          <Button asChild variant="secondary">
            <a href={clearHref}>{labels.clear}</a>
          </Button>
          <Button type="submit" className="flex-1">
            {labels.apply}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
