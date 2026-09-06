import { prisma } from './db';

/**
 * Lets a buyer opt in to a takeover notice AFTER their payment confirms — never before, and
 * never gated behind any login (this product has none). The only thing standing in for "proves
 * this is the same buyer" is knowledge of that exact payment's id: a long, unguessable cuid that
 * is only ever shown to the person the checkout redirect actually sent it to (the same trust
 * model src/app/checkout/result/page.tsx itself already relies on to show a real payment's
 * details to whoever loads that URL). Scoping the write to one specific CONFIRMED, non-BOOST
 * payment means this can only ever set the notification email for the brand that payment
 * actually belongs to — never an arbitrary Owner id.
 */
export type SetNotifyEmailResult = { outcome: 'saved' } | { outcome: 'not_eligible' };

export async function setOwnerNotifyEmail(paymentId: string, email: string): Promise<SetNotifyEmailResult> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.status !== 'CONFIRMED' || payment.kind !== 'TAKEOVER') {
    return { outcome: 'not_eligible' };
  }
  await prisma.owner.update({ where: { id: payment.ownerId }, data: { notifyEmail: email } });
  return { outcome: 'saved' };
}
