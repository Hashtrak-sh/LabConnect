import type { MessageKey } from '@/lib/i18n';
import type { OrgType } from './ops-model';

/** The text of an organisation type, from `messages/en.json`. */
export const ORG_TYPE_KEYS: Readonly<Record<OrgType, MessageKey>> = {
  CUSTOMER: 'ops.orgType.CUSTOMER',
  LAB: 'ops.orgType.LAB',
  PLATFORM: 'ops.orgType.PLATFORM',
};
