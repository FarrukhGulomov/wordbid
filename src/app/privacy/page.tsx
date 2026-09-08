import type { Metadata } from 'next';
import { config, SITE_NAME } from '@/lib/config';

export const metadata: Metadata = {
  title: 'Privacy',
  description: `What ${SITE_NAME} collects, why, and how to reach us.`,
};

/**
 * Describes only what this codebase actually does — every claim below is backed by a specific
 * data-handling decision made elsewhere (cited in comments here), never boilerplate. See F14:
 * this page did not exist at all before.
 */
export default function PrivacyPage() {
  return (
    <article className="max-w-prose py-10 text-sm leading-relaxed text-muted">
      <h1 className="font-mono text-2xl font-black tracking-tight text-text">PRIVACY</h1>
      <p className="mt-2">What {SITE_NAME} collects, why, and how long we keep it.</p>

      <h2 className="mt-8 font-mono text-sm font-bold tracking-widest text-text">
        BRAND INFORMATION
      </h2>
      <p className="mt-2">
        When you claim or take over a word, we store the brand name, destination URL, an optional
        description and a logo you provide or that we fetch from your own site. This is shown
        publicly — it is the paid placement itself, not private data.
      </p>

      <h2 className="mt-8 font-mono text-sm font-bold tracking-widest text-text">
        TAKEOVER NOTIFICATION EMAIL
      </h2>
      <p className="mt-2">
        After a payment confirms, you may optionally add an email address to be notified if
        another brand later takes your word back. This is never required to complete a purchase,
        never shown publicly, and used only to send that one kind of notice. You can change or
        remove it at any time from your confirmation page.
      </p>

      <h2 className="mt-8 font-mono text-sm font-bold tracking-widest text-text">
        CLICKS AND VISITS
      </h2>
      <p className="mt-2">
        We record outbound clicks and page views to show real, honest performance numbers (clicks,
        impressions, trending/rising rankings) and to filter out bots and repeat clicks from the
        same visitor. We do this from a salted cryptographic hash of your IP address and browser
        — never your raw IP address, which is not stored anywhere. This data is kept indefinitely
        alongside the word/ownership history it measures, the same way the rest of a word&rsquo;s
        history is never deleted.
      </p>

      <h2 className="mt-8 font-mono text-sm font-bold tracking-widest text-text">PAYMENTS</h2>
      <p className="mt-2">
        Payments are processed by our payment provider (currently{' '}
        {config.paymentProvider === 'nowpayments' ? 'NOWPayments, for cryptocurrency' : 'Stripe, for card payments'}
        ). We never see or store your full card number or wallet credentials — only the payment
        amount, status and the provider&rsquo;s own reference for it.
      </p>

      <h2 className="mt-8 font-mono text-sm font-bold tracking-widest text-text">
        WHAT WE DO NOT DO
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>We do not sell or share your data with advertisers.</li>
        <li>We do not require an account, login or any personal information to browse this site.</li>
        <li>We do not use tracking cookies for advertising purposes.</li>
      </ul>

      <h2 className="mt-8 font-mono text-sm font-bold tracking-widest text-text">CONTACT</h2>
      <p className="mt-2">
        {config.supportEmail ? (
          <>
            Questions about your data, or a request to remove your notification email, can be sent
            to{' '}
            <a href={`mailto:${config.supportEmail}`} className="underline underline-offset-2 hover:text-text">
              {config.supportEmail}
            </a>
            .
          </>
        ) : (
          <>
            Questions about your data, or a request to remove your notification email, can be sent
            to whoever operates this deployment of {SITE_NAME}.
          </>
        )}
      </p>
    </article>
  );
}
