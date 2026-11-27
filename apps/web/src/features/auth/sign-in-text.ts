import { t } from '@/lib/i18n';
import type { SignInText } from './SignInFlow';

const KEYS = [
  'emailLabel',
  'emailHelp',
  'sendCode',
  'sending',
  'newHere',
  'codeSent',
  'codeLabel',
  'codeHelp',
  'verify',
  'verifying',
  'resendIn',
  'resend',
  'sendNew',
  'otherEmail',
  'codeInvalid',
  'codeExpired',
  'lockedTitle',
  'locked',
  'lockedNoTime',
  'rateLimitedTitle',
  'rateLimited',
  'rateLimitedNoTime',
  'emailInvalid',
  'failed',
  'mfaTitle',
  'mfaIntro',
  'mfaLabel',
  'mfaHelp',
  'mfaSubmit',
  'mfaInvalid',
  'mfaLockedTitle',
  'mfaLocked',
  'mfaLockedNoTime',
  'enrolTitle',
  'enrolText',
] as const;

/** The text of the sign-in steps (board G1), for the sign-in and sign-up pages. */
export function signInText(): SignInText {
  return Object.fromEntries(KEYS.map((key) => [key, t(`auth.${key}`)])) as SignInText;
}
