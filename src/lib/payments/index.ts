import { config } from '../config';
import { MockPaymentProvider } from './mock';
import { StripePaymentProvider } from './stripe';
import { NowPaymentsProvider } from './nowpayments';
import type { PaymentProvider } from './types';

export type { PaymentProvider, CheckoutRequest, CheckoutSession, WebhookEvent } from './types';
export { MockPaymentProvider } from './mock';
export { NowPaymentsProvider } from './nowpayments';

const cache = new Map<string, PaymentProvider>();

function constructProvider(name: string): PaymentProvider {
  switch (name) {
    case 'stripe':
      return new StripePaymentProvider();
    case 'nowpayments':
      return new NowPaymentsProvider();
    case 'mock':
      if (process.env.NODE_ENV === 'production' && process.env.ALLOW_MOCK_PAYMENTS !== 'true') {
        throw new Error(
          'PAYMENT_PROVIDER=mock in production. Set PAYMENT_PROVIDER=stripe, or ALLOW_MOCK_PAYMENTS=true if this is a staging deploy.',
        );
      }
      return new MockPaymentProvider();
    default:
      throw new Error(`Unknown payment provider "${name}"`);
  }
}

/**
 * Returns (and caches) the provider implementation for an EXPLICIT provider name, regardless of
 * which provider is currently configured for new checkouts — see F09: a refund must go through
 * the same provider that actually processed the original payment (`Payment.provider`), which can
 * differ from the current `PAYMENT_PROVIDER` config after an operator migrates providers. Using
 * `getPaymentProvider()` (below) for a refund would silently ask the WRONG provider's API about a
 * reference it has never heard of.
 */
export function getPaymentProviderByName(name: string): PaymentProvider {
  let provider = cache.get(name);
  if (!provider) {
    provider = constructProvider(name);
    cache.set(name, provider);
  }
  return provider;
}

/** Returns the currently configured provider. Constructed lazily so missing provider keys fail loudly, once. */
export function getPaymentProvider(): PaymentProvider {
  return getPaymentProviderByName(config.paymentProvider);
}
