import { Prisma, type SlotStatus } from '@labconnect/database';

// Slot capacity (`CapacityService` in MODULE_BOUNDARIES: labs owns `slot`). The booking module
// holds and releases places through these functions; the counts are kept by code, and the
// database refuses overbooking (C-15: held_count + booked_count <= capacity). Concurrent bookings
// for the last place: the first to commit wins, by a row lock on the slot (BR-011).
//
// Lock order, to stay free of deadlocks: the booking first (the engine locks it before any guard or
// effect runs), then its slot; a step that needs two slots (T-07 moving to the proposed slot) locks
// them in id order. Code that locks a slot and then bookings would invert this; do not.

export interface SlotCapacity {
  id: string;
  labSiteId: string;
  slotDate: Date;
  startsAt: Date;
  status: SlotStatus;
  capacity: number;
  heldCount: number;
  bookedCount: number;
}

/** The slot, locked for this transaction (`FOR UPDATE`), or `null` if there is none. */
export function lockSlot(
  tx: Prisma.TransactionClient,
  slotId: string,
): Promise<SlotCapacity | null> {
  return slotRow(tx, slotId, true);
}

/** The slot without a lock (a check that writes nothing), or `null` if there is none. */
export function readSlot(
  tx: Prisma.TransactionClient,
  slotId: string,
): Promise<SlotCapacity | null> {
  return slotRow(tx, slotId, false);
}

async function slotRow(
  tx: Prisma.TransactionClient,
  slotId: string,
  lock: boolean,
): Promise<SlotCapacity | null> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      lab_site_id: string;
      slot_date: Date;
      starts_at: Date;
      status: SlotStatus;
      capacity: number;
      held_count: number;
      booked_count: number;
    }[]
  >(Prisma.sql`
    SELECT id::text AS id, lab_site_id::text AS lab_site_id, slot_date, starts_at, status,
           capacity, held_count, booked_count
      FROM slot WHERE id = ${slotId}::uuid ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`);
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    labSiteId: row.lab_site_id,
    slotDate: row.slot_date,
    startsAt: row.starts_at,
    status: row.status,
    capacity: row.capacity,
    heldCount: row.held_count,
    bookedCount: row.booked_count,
  };
}

/** Whether a booking can still take a place in the slot: open, not started, with room left. */
export function slotHasRoom(slot: SlotCapacity, now: Date): boolean {
  return (
    slot.status === 'OPEN' &&
    slot.startsAt.getTime() > now.getTime() &&
    slot.heldCount + slot.bookedCount < slot.capacity
  );
}

/**
 * Moves one place between the slot's counts: `hold` (+1 held), `confirm` (held to booked),
 * `releaseHeld` (-1 held), `releaseBooked` (-1 booked), `book` (+1 booked). The database refuses a count below zero
 * or above the capacity.
 */
export async function moveSlotPlace(
  tx: Prisma.TransactionClient,
  slotId: string,
  move: 'hold' | 'confirm' | 'releaseHeld' | 'releaseBooked' | 'book',
): Promise<void> {
  const change = {
    hold: Prisma.sql`held_count = held_count + 1`,
    confirm: Prisma.sql`held_count = held_count - 1, booked_count = booked_count + 1`,
    releaseHeld: Prisma.sql`held_count = held_count - 1`,
    releaseBooked: Prisma.sql`booked_count = booked_count - 1`,
    book: Prisma.sql`booked_count = booked_count + 1`,
  }[move];
  await tx.$executeRaw(Prisma.sql`
    UPDATE slot SET ${change}, lock_version = lock_version + 1, updated_at = now()
     WHERE id = ${slotId}::uuid`);
}
