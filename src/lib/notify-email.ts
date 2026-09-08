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

/**
 * Masks an email for display back to whoever is currently looking at a payment's confirmation
 * page — see F04: Owner is keyed purely by destination DOMAIN, which is text anyone can type
 * into checkout, never something we verify control of. Two completely unrelated buyers can both
 * submit the same domain (one now, one months later) and land on the same Owner row, so a value
 * set by the FIRST one must never be shown in full to the second — that would hand a stranger's
 * real contact address to whoever next happens to type in the same domain string. Masking still
 * lets the legitimate original brand recognise "yes, that's my address" without exposing it to
 * anyone else who only shares the domain in name.
 */
export function maskEmailForDisplay(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '••••••';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const maskedLocal = local[0] + '•'.repeat(Math.max(local.length - 1, 1));
  const dot = domain.lastIndexOf('.');
  const maskedDomain =
    dot > 0 ? '•'.repeat(Math.max(dot, 1)) + domain.slice(dot) : '•'.repeat(Math.max(domain.length, 1));
  return `${maskedLocal}@${maskedDomain}`;
}

export async function setOwnerNotifyEmail(paymentId: string, email: string): Promise<SetNotifyEmailResult> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.status !== 'CONFIRMED' || payment.kind !== 'TAKEOVER') {
    return { outcome: 'not_eligible' };
  }
  await prisma.owner.update({ where: { id: payment.ownerId }, data: { notifyEmail: email } });
  return { outcome: 'saved' };
}
