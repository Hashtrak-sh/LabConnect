import { uuidv7 } from '../ids.js';
import type { Tx } from './reference.js';

export const DEFAULT_PLATFORM_ORG_NAME = 'LabConnect Platform';

/** The platform organisation. There is one; it is created the first time it is needed. */
export async function ensurePlatformOrganisation(
  tx: Tx,
  name: string = DEFAULT_PLATFORM_ORG_NAME,
): Promise<string> {
  const existing = await tx.organisation.findFirst({
    where: { orgType: 'PLATFORM' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (existing) return existing.id;
  const id = uuidv7();
  await tx.organisation.create({
    data: {
      id,
      orgType: 'PLATFORM',
      legalName: name,
      displayName: name,
      claimStatus: 'NOT_APPLICABLE',
    },
  });
  await tx.organisationPrivate.create({ data: { id: uuidv7(), organisationId: id } });
  return id;
}

export interface PlatformAdminInput {
  email: string;
  fullName: string;
  organisationName?: string;
}

export interface PlatformAdminResult {
  userId: string;
  organisationId: string;
  /** False when the user already was a platform administrator. */
  created: boolean;
}

/**
 * `seed:platform-admin`: the first PLATFORM_ADMIN. The user signs in with an email OTP;
 * `mfa_enrolled_at` is empty, so MFA enrolment is forced on the first login. Safe to
 * run again: it adds only what is missing.
 */
export async function seedPlatformAdmin(
  tx: Tx,
  input: PlatformAdminInput,
): Promise<PlatformAdminResult> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('The platform administrator email is not a valid address.');
  }
  if (!input.fullName.trim()) throw new Error('The platform administrator name is empty.');

  const organisationId = await ensurePlatformOrganisation(tx, input.organisationName);
  let created = false;

  let user = await tx.appUser.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  });
  if (user && !user.isPlatformStaff) {
    throw new Error(
      'A user with this email exists and is not platform staff. A customer or lab user cannot become a platform administrator.',
    );
  }
  if (!user) {
    user = await tx.appUser.create({
      data: {
        id: uuidv7(),
        email,
        fullName: input.fullName.trim(),
        status: 'ACTIVE',
        isPlatformStaff: true,
      },
    });
    created = true;
  }

  let membership = await tx.membership.findUnique({
    where: { userId_organisationId: { userId: user.id, organisationId } },
  });
  if (!membership) {
    membership = await tx.membership.create({
      data: {
        id: uuidv7(),
        userId: user.id,
        organisationId,
        status: 'ACTIVE',
        activatedAt: new Date(),
      },
    });
    created = true;
  }

  const role = await tx.membershipRole.findFirst({
    where: { membershipId: membership.id, role: 'PLATFORM_ADMIN', revokedAt: null },
  });
  if (!role) {
    await tx.membershipRole.create({
      data: { id: uuidv7(), membershipId: membership.id, role: 'PLATFORM_ADMIN' },
    });
    created = true;
  }

  return { userId: user.id, organisationId, created };
}
