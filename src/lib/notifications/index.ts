import { config } from '../config';
import { ConsoleNotificationProvider } from './console';
import { ResendNotificationProvider } from './resend';
import type { NotificationProvider } from './types';

export type { NotificationProvider, TakeoverNotice } from './types';
export { ConsoleNotificationProvider } from './console';

let cached: NotificationProvider | null = null;

/** Returns the configured provider. Constructed lazily so a missing Resend key fails loudly, once. */
export function getNotificationProvider(): NotificationProvider {
  if (cached && cached.name === config.notificationProvider) return cached;

  switch (config.notificationProvider) {
    case 'resend':
      cached = new ResendNotificationProvider();
      break;
    case 'console':
      cached = new ConsoleNotificationProvider();
      break;
    default:
      throw new Error(`Unknown NOTIFICATION_PROVIDER "${config.notificationProvider}"`);
  }
  return cached;
}
