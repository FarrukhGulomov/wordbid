import type { Metadata } from 'next';
import { config, SITE_NAME } from '@/lib/config';
import { formatUsd } from '@/lib/money';

export const metadata: Metadata = {
  title: 'Terms',
  description: `What you are and are not buying on ${SITE_NAME}.`,
};

// Otherwise this page would be statically prerendered at build time, freezing the header's
// live online/visitor proof numbers into this page's HTML forever until the next deploy.
export const dynamic = 'force-dynamic';

export default function TermsPage() {
  return (
    <article className="max-w-prose py-10 text-sm leading-relaxed text-muted">
      <h1 className="font-mono text-2xl font-black tracking-tight text-text">TERMS</h1>

      <h2 className="mt-8 font-mono text-sm font-bold tracking-widest text-text">
        WHAT YOU ARE BUYING
      </h2>
      <p className="mt-2">
        A paid placement on {SITE_NAME}: your brand name, logo and link shown against a word, and a
        position on our leaderboard determined by the amount you paid. That is the entire product.
      </p>

      <h2 className="mt-8 font-mono text-sm font-bold tracking-widest text-text">
        WHAT YOU ARE NOT BUYING
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          Any legal ownership of a word, a trademark, a domain name or any other intellectual
          property. Placement here has no effect outside this website.
        </li>
        <li>
          Any guarantee of impressions, clicks, visitors, customers, conversions, revenue or return
          on your spend.
        </li>
        <li>Any permanent position. Another brand can take your word at any time by paying more.</li>
      </ul>

      <h2 className="mt-8 font-mono text-sm font-bold tracking-widest text-text">RANKING</h2>
      <p className="mt-2">
        The leaderboard is ordered by the amount the current owner paid, highest first. Where two
        words are worth the same, the one confirmed earlier ranks higher. Rank changes only after a
        payment is confirmed by our payment provider. Nothing is reserved while a checkout is open.
      </p>
      <p className="mt-2">
        Ranking is a record of what was paid. It is not a measure of quality, popularity, accuracy
        or trustworthiness, and it is not an endorsement of any listed brand.
      </p>

      <h2 className="mt-8 font-mono text-sm font-bold tracking-widest text-text">PRICES</h2>
      <p className="mt-2">
        An unclaimed word starts at {formatUsd(config.startingPriceCents)}. Taking an owned word
        costs at least {config.takeoverIncrementPercent}% more than its current value. Previous
        owners are not paid when a word changes hands.
      </p>

      <h2 className="mt-8 font-mono text-sm font-bold tracking-widest text-text">
        FAILED TAKEOVERS
      </h2>
      <p className="mt-2">
        If another brand&rsquo;s payment confirms before yours, you do not receive the word and your
        payment is refunded in full. Your bid is checked against the live value at the moment your
        payment is confirmed, not when you started checkout.
      </p>

      <h2 className="mt-8 font-mono text-sm font-bold tracking-widest text-text">MODERATION</h2>
      <p className="mt-2">
        We may remove any word, brand or link — including for illegal, deceptive or abusive content,
        or a destination that does not work. Removed placements are refunded.
      </p>

      <h2 className="mt-8 font-mono text-sm font-bold tracking-widest text-text">REFUNDS</h2>
      <p className="mt-2">
        Refunds owed under this page are always issued in full. For a card payment this happens
        automatically. For a cryptocurrency payment, an automatic refund is not always possible —
        we process these manually to the original payment instead, which can take longer.
      </p>

      {/* CGPT-F03: this page told a crypto buyer their refund would be manual and "can take longer",
          then gave no way to ask about one — no contact channel, no expected response time, no
          pointer to the one thing they need to reference it (the confirmation page URL, which IS
          the order record since there are no accounts). All three now live in one place. */}
      <h2 id="contact" className="mt-8 scroll-mt-4 font-mono text-sm font-bold tracking-widest text-text">
        GETTING HELP
      </h2>
      <p className="mt-2">
        {config.supportEmail ? (
          <>
            For a refund that has not arrived, a manual crypto refund, or any other question about
            a payment, email{' '}
            <a
              href={`mailto:${config.supportEmail}`}
              className="inline-flex min-h-6 items-center align-middle underline underline-offset-2 hover:text-text"
            >
              {config.supportEmail}
            </a>
            . We reply within a few business days.
          </>
        ) : (
          <>
            For a refund that has not arrived, a manual crypto refund, or any other question about
            a payment, contact whoever operates this deployment of {SITE_NAME}.
          </>
        )}{' '}
        There are no accounts on {SITE_NAME}, so the confirmation link you were sent to after
        paying (the page at <span className="text-text">/checkout/result?payment=…</span>) is your
        only record of the order — include that link, or the payment ID in it, in any message you
        send.
      </p>
    </article>
  );
}
