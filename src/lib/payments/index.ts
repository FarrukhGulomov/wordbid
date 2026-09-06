import { config } from '../config';
import { MockPaymentProvider } from './mock';
import { StripePaymentProvider } from './stripe';
import { NowPaymentsProvider } from './nowpayments';
import type { PaymentProvider } from './types';

export type { PaymentProvider, CheckoutRequest, CheckoutSession, WebhookEvent } from './types';
export { MockPaymentProvider } from './mock';
export { NowPaymentsProvider } from './nowpayments';

let cached: PaymentProvider | null = null;

/** Returns the configured provider. Constructed lazily so missing provider keys fail loudly, once. */
export function getPaymentProvider(): PaymentProvider {
  if (cached && cached.name === config.paymentProvider) return cached;

  switch (config.paymentProvider) {
    case 'stripe':
      cached = new StripePaymentProvider();
      break;
    case 'nowpayments':
      cached = new NowPaymentsProvider();
      break;
    case 'mock':
      if (process.env.NODE_ENV === 'production' && process.env.ALLOW_MOCK_PAYMENTS !== 'true') {
        throw new Error(
          'PAYMENT_PROVIDER=mock in production. Set PAYMENT_PROVIDER=stripe, or ALLOW_MOCK_PAYMENTS=true if this is a staging deploy.',
        );
      }
      cached = new MockPaymentProvider();
      break;
    default:
      throw new Error(`Unknown PAYMENT_PROVIDER "${config.paymentProvider}"`);
  }
  return cached;
}
