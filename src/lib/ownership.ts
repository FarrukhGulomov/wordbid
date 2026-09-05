import { Prisma, PaymentStatus, ActivityType } from '@prisma/client';
import { prisma } from './db';
import { bidWins } from './pricing';
import type { PrismaClient } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export type ConfirmOutcome =
  /** Ownership granted, ranking updated. */
  | { outcome: 'won'; paymentId: string; wordId: string; ownershipId: string }
  /** Money captured but the word was not won. The caller must refund. */
  | { outcome: 'lost'; paymentId: string; amountCents: number; reason: string }
  /** This exact provider event was already applied. Nothing changed. */
  | { outcome: 'duplicate' }
  /** The payment was already confirmed by an earlier, different event. Nothing changed. */
  | { outcome: 'already_confirmed'; paymentId: string }
  /** We have no payment with that provider reference. */
  | { outcome: 'unknown_payment' };

/**
 * Applies a successful payment.
 *
 * This is the ONLY place a word's value, owner or rank changes. Everything is done inside a
 * single transaction that holds a row lock on the word, so two simultaneous takeovers of the
 * same word are serialised and exactly one of them wins.
 *
 * Idempotency has two independent guards:
 *   1. WebhookEvent has a unique (provider, eventId) — a redelivered event aborts the transaction.
 *   2. Ownership has a unique paymentId — one payment can never produce two ownerships.
 */
export async function confirmPayment(
  provider: string,
  eventId: string,
  providerReference: string,
  client: PrismaClient = prisma,
): Promise<ConfirmOutcome> {
  try {
    return await client.$transaction(async (tx: Tx) => {
      // Guard 1: recording the event and applying it succeed or fail together.
      await tx.webhookEvent.create({ data: { provider, eventId } });

      const payment = await tx.payment.findUnique({
        where: { providerReference },
        include: { owner: true },
      });
      if (!payment) return { outcome: 'unknown_payment' } as const;

      if (payment.status === PaymentStatus.CONFIRMED) {
        return { outcome: 'already_confirmed', paymentId: payment.id } as const;
      }
      if (
        payment.status === PaymentStatus.REFUNDED ||
        payment.status === PaymentStatus.REFUND_PENDING
      ) {
        return { outcome: 'already_confirmed', paymentId: payment.id } as const;
      }

      // Serialise every confirmation touching this word.
      await tx.$executeRaw`SELECT id FROM "Word" WHERE id = ${payment.wordId} FOR UPDATE`;

      const word = await tx.word.findUniqueOrThrow({ where: { id: payment.wordId } });
      const now = new Date();

      const loses = (reason: string) =>
        tx.payment
          .update({
            where: { id: payment.id },
            data: { status: PaymentStatus.REFUND_PENDING, failureReason: reason },
          })
          .then(
            () =>
              ({
                outcome: 'lost',
                paymentId: payment.id,
                amountCents: payment.amountCents,
                reason,
              }) as const,
          );

      if (word.blocked) {
        return loses('This word was removed by moderation before your payment completed.');
      }
      if (payment.owner.blocked) {
        return loses('This account was suspended before the payment completed.');
      }
      // Re-checked against the LIVE value, not the value shown at checkout.
      if (!bidWins(payment.amountCents, word.valueCents)) {
        return loses('Another brand took this word at a higher price before your payment completed.');
      }

      // Close the outgoing ownership, if any.
      let previousOwnerName: string | null = null;
      if (word.currentOwnershipId) {
        const previous = await tx.ownership.update({
          where: { id: word.currentOwnershipId },
          data: { endedAt: now },
          include: { owner: { select: { name: true } } },
        });
        previousOwnerName = previous.owner.name;
      }

      // Guard 2: unique paymentId makes a second ownership from this payment impossible.
      const ownership = await tx.ownership.create({
        data: {
          wordId: word.id,
          ownerId: payment.ownerId,
          amountCents: payment.amountCents,
          paymentId: payment.id,
          startedAt: now,
        },
      });

      await tx.word.update({
        where: { id: word.id },
        data: {
          valueCents: payment.amountCents,
          currentOwnershipId: ownership.id,
          ownedSince: now,
        },
      });

      await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.CONFIRMED, confirmedAt: now, failureReason: null },
      });

      await tx.activity.create({
        data: {
          type: previousOwnerName ? ActivityType.TAKEOVER : ActivityType.CLAIMED,
          wordId: word.id,
          ownerId: payment.ownerId,
          amountCents: payment.amountCents,
          previousOwnerName,
        },
      });

      return { outcome: 'won', paymentId: payment.id, wordId: word.id, ownershipId: ownership.id } as const;
    });
  } catch (err) {
    // Unique violation on (provider, eventId) => this event was already applied.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { outcome: 'duplicate' };
    }
    throw err;
  }
}

/** Marks a payment as failed after the provider reports it will not complete. Never touches ranking. */
export async function failPayment(
  provider: string,
  eventId: string,
  providerReference: string,
  client: PrismaClient = prisma,
): Promise<'failed' | 'duplicate' | 'ignored'> {
  try {
    return await client.$transaction(async (tx: Tx) => {
      await tx.webhookEvent.create({ data: { provider, eventId } });
      const result = await tx.payment.updateMany({
        // Only a payment still waiting for money can fail. A confirmed one is untouchable.
        where: { providerReference, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.FAILED, failureReason: 'The payment was not completed.' },
      });
      return result.count > 0 ? ('failed' as const) : ('ignored' as const);
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return 'duplicate';
    }
    throw err;
  }
}
