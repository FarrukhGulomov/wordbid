import { Prisma, PaymentStatus, PaymentKind, ActivityType } from '@prisma/client';
import { prisma } from './db';
import { bidWins } from './pricing';
import type { PrismaClient } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export type ConfirmOutcome =
  /** Ownership granted, ranking updated. */
  | { outcome: 'won'; paymentId: string; wordId: string; ownershipId: string }
  /** The current owner's value was raised. Same ownership period, ranking updated. */
  | { outcome: 'boosted'; paymentId: string; wordId: string; ownershipId: string; newValueCents: number }
  /** Money captured but the word was not won (or the boost no longer applies). Caller must refund. */
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
 * single transaction that holds a row lock on the word, so two simultaneous takeovers/boosts of
 * the same word are serialised and exactly one view of it wins.
 *
 * Idempotency has two independent guards:
 *   1. WebhookEvent has a unique (provider, eventId) — a redelivered event aborts the transaction.
 *   2. Ownership has a unique paymentId — one payment can never produce two ownerships.
 *
 * Payment.kind decides which of two very different things happens:
 *   - TAKEOVER (claim or takeover): ends the previous ownership (if any) and starts a new one.
 *     `payment.amountCents` is the full winning bid and becomes the word's new value.
 *   - BOOST: the CURRENT owner raises their own value. No ownership row is created or ended —
 *     history, analytics and clicks stay exactly as they are. `payment.amountCents` is only the
 *     difference charged, so the new value is the LIVE value plus that difference, never a
 *     value fixed at checkout time — see the BOOST branch below for why that is race-safe.
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

      if (payment.kind === PaymentKind.BOOST) {
        if (word.blocked) {
          return loses('This word was removed by moderation before your boost completed.');
        }
        if (payment.owner.blocked) {
          return loses('This account was suspended before your boost completed.');
        }
        if (!word.currentOwnershipId) {
          return loses('This word is no longer owned, so the boost could not be applied.');
        }
        const currentOwnership = await tx.ownership.findUniqueOrThrow({
          where: { id: word.currentOwnershipId },
        });
        if (currentOwnership.ownerId !== payment.ownerId) {
          return loses('Another brand took over this word before your boost completed.');
        }

        // The LIVE value plus the difference actually charged — never a value fixed at
        // checkout time. This is what keeps a concurrent boost + takeover race safe: whichever
        // of the two commits first, the second always builds on top of the row it just locked,
        // so `word.valueCents` and the active ownership's `amountCents` can never disagree.
        const newValueCents = word.valueCents + payment.amountCents;

        await tx.ownership.update({
          where: { id: currentOwnership.id },
          data: { amountCents: newValueCents },
        });
        await tx.word.update({ where: { id: word.id }, data: { valueCents: newValueCents } });
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.CONFIRMED, confirmedAt: now, failureReason: null },
        });

        return {
          outcome: 'boosted',
          paymentId: payment.id,
          wordId: word.id,
          ownershipId: currentOwnership.id,
          newValueCents,
        } as const;
      }

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
