# OwnTheInternet

Brands compete to own a word — and a position — on one global leaderboard.

```
WORD + BRAND + BID → PAYMENT → GLOBAL RANK → VISIBILITY + CLICKS → SHARE → TAKEOVER → RECLAIM
```

Owning a word here is **temporary paid placement on this platform**. It is not legal ownership
of a word, a trademark, a domain or any intellectual property.

## Architecture

One Next.js 15 app and one Postgres database. That is the whole system.

| Concern | Choice | Why |
| --- | --- | --- |
| App | Next.js 15 App Router (TypeScript) | Pages, API routes and the webhook in one deployable |
| Data | PostgreSQL 16 + Prisma | Row locks make the takeover race correct; migrations are checked in |
| Payments | Provider interface + Stripe | One file to swap processors; a mock provider for local dev |
| Styling | Tailwind v4 | No component library to maintain |
| Tests | Vitest | Unit tests for rules, integration tests against real Postgres |

There is no queue, no cache, no separate backend service and no microservices. One founder can
hold this in their head.

### Where the money rules live

- `src/lib/pricing.ts` — starting price, takeover premium, "does this bid win".
- `src/lib/ownership.ts` — **the only code that changes a word's value, owner or rank.**
- `src/app/api/webhooks/payments/route.ts` — the only caller of the above.

Ranking is `current value DESC`, ties broken by the earlier confirmed ownership. Rank changes
only after a payment is confirmed; nothing is reserved while a checkout is open.

### Boost — raising your own rank

A **takeover** is one brand replacing another: a new Ownership period starts, the old one ends,
and the new owner's clicks/impressions start at zero. A **boost** is the opposite — the *current*
owner raises their own word's value to move up the leaderboard, paying only the difference. It
never changes who owns the word, never touches the ownership period, and never resets analytics.

- `POST /api/boost` (`src/app/api/boost/route.ts`) takes only `{ word, targetValueCents }` — no
  brand name, URL or description. The owner it charges is always looked up from the word's live
  current ownership, never taken from the request, so a boost can never be attributed to the
  wrong brand even though this product has no login.
- `targetValueCents` must clear the same step `minimumBidCents` already uses for a takeover,
  applied to the word's own current value — re-checked against the *live* value, same as a bid.
- `confirmPayment`'s BOOST branch (`src/lib/ownership.ts`) sets the new value to the *live* value
  plus the difference actually charged, never a value fixed at checkout time. That is what keeps
  a boost racing a takeover on the same word transaction-safe: whichever commits first under the
  row lock, the second always builds on top of what it just locked. If the word changed owner
  before a boost confirms, the boost loses and is refunded, exactly like a losing takeover bid.

### BidRank & rank history

Ranking has always been server-authoritative — the client never supplies rank, only a bid
amount, and the leaderboard is always computed live from `Word.valueCents` at read time. What
was missing was a *named, centralized, extensible* place for that to live, and a record of how a
word's rank moves over time. Both now do.

- **`src/lib/bidrank.ts`** — `computeBidRank({ bidStrengthCents })`. Today bid strength (the
  word's confirmed value) is the only signal that can be calculated reliably and honestly; the
  module exists so a future signal (quality, engagement, trust, freshness) is a weight added
  here, not a rewrite of the leaderboard query or the payment path. The weights are internal —
  never exposed on any public API or client bundle — and today's weights make
  `computeBidRank` numerically identical to `bidStrengthCents` alone, so this changed nothing
  about current ranking behavior; `tests/bidrank.test.ts` locks that down.
- **`RankSnapshot`** (one row per word per day) records the word's real, observed rank and value
  whenever its page is actually viewed (`getWordByNormalized`) — never backfilled or estimated.
  It powers the word page's position-gained/lost badge (`▲ UP 2` / `▼ DOWN 1`, shown only when a
  real prior observation exists — never a fabricated "no change") and is deliberately generic
  enough to also become the substrate for momentum/trending and reputation history later without
  a schema rewrite.
- The word page also shows the real, live cost to reach #1 (the same `minimumBidCents` step
  already used everywhere else, applied to the current #1's value) — not a separate pricing
  engine, just the existing one applied to a different row.
- **Before paying**, the claim form shows where the entered amount would rank TODAY
  (`getProjectedRank` in `src/lib/queries.ts`, surfaced via `GET /api/words/[word]?amount=`) —
  the same "value DESC" comparison `getRank` already does, just against a hypothetical amount
  instead of an existing word's stored value. Never shown for an amount that wouldn't even win
  the word, and always framed as a live snapshot, not a promise: the board can move before the
  payment confirms, exactly like the price itself already can.

### Discovery / the attention engine

WordBid has to answer a question BidRank alone can't: why would a visitor come back if they're
never going to pay? `src/lib/discovery.ts` is the centralized answer — one system, five views
over the same leaderboard data, never five parallel systems:

- **Top** — the plain BidRank leaderboard (`getLeaderboard`), unchanged.
- **Trending** (`getTrendingWords`) — real clicks in the trailing 7 days on the word's *current*
  ownership only (a takeover never inherits a previous owner's numbers, same rule as everywhere
  else — see `Word.clickCount`'s doc comment). Requires a real minimum click count; a single
  stray click is never "trending".
- **Rising** (`getRisingWords`) — rank climbed since the oldest real `RankSnapshot` observation
  available between 3 and 14 days ago. A word with no observation in that window is simply
  absent from the list — never a fabricated rise.
- **Hidden Gems** (`getHiddenGems`) — real CTR divided by a promotion penalty that grows with the
  word's paid value, restricted to words outside the top 3 (already visible by definition) with
  a real minimum sample size. **Paying more can only ever lower this score** — there is no way to
  raise it with money, only with real clicks relative to real impressions;
  `tests/discovery.test.ts` proves a costlier word with identical engagement never outranks a
  cheaper one.
- **New** — most recently claimed, by `Word.ownedSince`, never gated by payment amount.
- **Active** — not a ranking view at all, deliberately: it reuses the exact `Activity` rows the
  homepage's own LIVE strip and `confirmPayment` already write (`getRecentActivity`), just more
  of them. Every real claim, takeover, reclaim and boost, most recent first — the direct answer
  to "a low-rank word is still real, current activity". No new feed, no new schema.

Every view is a bounded read (at most two or three queries regardless of word count, scanning up
to 500 owned words in memory) — no N+1, no per-request re-ranking of the whole board beyond that
scan. **Scaling note:** that 500-word scan is a pragmatic MVP cap, not a claim it scans "all"
words forever; past that scale, Trending/Rising/Hidden Gems would need their own indexed queries
instead of filtering the in-memory board.

**Abuse protection**, because these signals now directly decide what a visitor sees on the
homepage: clicks were already deduplicated per visitor and bot-filtered
(`CLICK_DEDUPE_WINDOW_SECONDS`, `looksLikeBot`); impressions were already bot-filtered and rate
limited (30/min/IP). New in this pass: `/go/<word>` is now also rate limited per IP (20/min) —
tracking is skipped, never the redirect itself, above that — specifically to blunt a script
hammering the endpoint to inflate Trending or Hidden Gems from many simulated visitors.

### Payment correctness

1. **Verified.** The webhook signature is checked against the raw request body. Bad signature → 400.
2. **Idempotent.** Two independent guards: a unique `(provider, eventId)` on `WebhookEvent`, so a
   redelivery aborts the transaction; and a unique `paymentId` on `Ownership`, so one payment can
   never produce two ownerships.
3. **Serialised.** Confirmation takes `SELECT … FOR UPDATE` on the word row, so simultaneous
   takeovers of the same word are ordered and exactly one wins.
4. **Re-checked late.** The bid is compared against the *live* value at confirmation time, not the
   value shown at checkout. A bid that no longer wins does not get the word.
5. **Refunded, never pocketed.** A captured payment that loses the race is refunded through the
   provider. If the refund call fails, the payment sits in `REFUND_PENDING` and appears in `/admin`.

## Running locally

Requires Node 22+ and PostgreSQL 16.

```bash
npm install
cp .env.example .env          # then edit — see below
createdb owntheinternet
npm run db:migrate            # creates the schema
npm run db:seed               # optional: obviously-fake sample rows
npm run dev                   # http://localhost:3000
```

With `PAYMENT_PROVIDER=mock` there is no external service and no card details: checkout goes to an
in-app sandbox page whose Pay/Cancel buttons post a **signed event to the real webhook endpoint**,
so local development exercises the production confirmation path.

### Tests

```bash
createdb owntheinternet_test
cp .env.test.example .env.test   # DATABASE_URL must point at the *test* database
npm test
```

The suite refuses to run unless the database name contains `test`. Migrations are applied
automatically before the first test.

```bash
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm run build      # production build
```

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | **yes** | — | Postgres connection string |
| `CLICK_HASH_SALT` | **yes** | — | Salt for hashing visitor IP+UA. Long random string. Raw IPs are never stored |
| `ADMIN_TOKEN` | **yes** | — | Password for `/admin`. Long random string, min 8 chars |
| `NEXT_PUBLIC_SITE_URL` | **yes in prod** | `http://localhost:3000` | Canonical origin; used for checkout redirects, OG tags and the sitemap |
| `PAYMENT_PROVIDER` | no | `mock` | `stripe`, `nowpayments` or `mock`. **`mock` is refused in production** unless `ALLOW_MOCK_PAYMENTS=true` |
| `STRIPE_SECRET_KEY` | with Stripe | — | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | with Stripe | — | Signing secret for the webhook endpoint |
| `STRIPE_CURRENCY` | no | `usd` | Checkout currency |
| `NOWPAYMENTS_API_KEY` | with NOWPayments | — | NOWPayments API key |
| `NOWPAYMENTS_IPN_SECRET` | with NOWPayments | — | IPN signing secret, used to verify `x-nowpayments-sig` |
| `STARTING_PRICE_CENTS` | no | `1000` | Price of an unclaimed word ($10) |
| `TAKEOVER_INCREMENT_PERCENT` | no | `5` | Minimum premium to take an owned word |
| `MAX_AMOUNT_CENTS` | no | `10000000` | Ceiling on a single claim ($100,000) |
| `CLICK_DEDUPE_WINDOW_SECONDS` | no | `1800` | Repeat clicks by one visitor inside this window are not counted |
| `NOTIFICATION_PROVIDER` | no | `console` | `console` or `resend` — see **Notifications** |
| `RESEND_API_KEY` | with Resend | — | Resend API key |
| `RESEND_FROM_EMAIL` | with Resend | — | Verified "from" address for takeover notice emails |

### Connecting Stripe

1. Set `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_SITE_URL`.
2. Add a webhook endpoint in the Stripe dashboard pointing at
   `https://<your-domain>/api/webhooks/payments`, subscribed to:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`.
3. Put that endpoint's signing secret in `STRIPE_WEBHOOK_SECRET`.
4. Locally: `stripe listen --forward-to localhost:3000/api/webhooks/payments`.

Until these are set, `PAYMENT_PROVIDER=stripe` fails loudly at the first checkout rather than
pretending to work.

### Connecting NOWPayments (crypto)

`src/lib/payments/nowpayments.ts` implements the exact same `PaymentProvider` interface Stripe
and the mock provider do — see **Where the money rules live**. It ships with **no real
credentials, wallet addresses, or live API calls anywhere in this repo**: `NOWPAYMENTS_API_KEY`
and `NOWPAYMENTS_IPN_SECRET` are placeholders in `.env.example`, and the class throws loudly at
construction if either is missing, exactly like `StripePaymentProvider` does for its own keys.
Nothing here is exercised unless an operator explicitly sets `PAYMENT_PROVIDER=nowpayments` with
real values.

**Before enabling it for real payments, an authorized NOWPayments account owner must:**

1. Create a NOWPayments account and complete whatever KYC/business verification NOWPayments
   itself requires for the account — this repo does not perform, replace, or check that.
2. Generate an API key in the NOWPayments dashboard and set `NOWPAYMENTS_API_KEY`.
3. Generate (or view) the account's IPN secret key and set `NOWPAYMENTS_IPN_SECRET` — this is
   what verifies every incoming callback actually came from NOWPayments (`x-nowpayments-sig`,
   HMAC-SHA512 over the IPN body's keys sorted alphabetically).
4. Point the account's IPN callback URL at `https://<your-domain>/api/webhooks/payments` — the
   same single webhook endpoint every provider already shares.
5. Set `PAYMENT_PROVIDER=nowpayments` and `NEXT_PUBLIC_SITE_URL`.
6. Decide which cryptocurrencies to accept in the NOWPayments dashboard — this integration lets
   the buyer choose on NOWPayments' own hosted invoice page; nothing here picks a coin.

**What this integration deliberately does NOT do:**

- **Refunds.** `refund()` always throws. A crypto refund needs a wallet address to send money
  back to, which this integration never collects from the buyer — there is nowhere to send it.
  A NOWPayments payment that loses the takeover race lands in `/admin`'s "REFUNDS NEEDING
  ATTENTION" list like any failed refund attempt, for a human to resolve directly in the
  NOWPayments dashboard. This is the same reconciliation path every provider already uses (see
  **Refunds** below) — nothing provider-specific was added to it.
- **Amount verification against the webhook.** Like every provider, `confirmPayment` never
  trusts a webhook's own reported amount — it only ever re-checks the bid against
  `Word.valueCents` and applies `Payment.amountCents` already stored in our own database at
  checkout time (see **Payment correctness**). A crypto IPN's amount is in the coin the buyer
  paid with, not USD cents, and is never compared against anything; it is carried through
  `WebhookEvent.amountCents` purely for shape-parity with the other providers' events.
- **Confirming on-chain "confirmed" status.** NOWPayments' `payment_status` moves through
  `waiting` → `confirming` → `confirmed` → `finished` (plus `failed`/`expired`/`partially_paid`/
  `refunded`). Only `finished` — money actually settled and credited — is treated as a
  successful payment; every earlier status is acknowledged and ignored, never applied.

**The age/eligibility notice.** When `PAYMENT_PROVIDER=nowpayments`, both the claim form and the
BOOST buttons show a plain, inline "Crypto payments — 18+ only" notice (`CryptoPaymentNotice`) —
never a modal, matching WordBid's no-interstitial checkout everywhere else. It is disclosure, not
verification: it does not check anyone's age, and does not replace whatever KYC or eligibility
checks NOWPayments applies on its own hosted invoice page.

## Deploying

```bash
npm run db:deploy   # apply migrations
npm run build
npm start
```

Run **one instance** to start. The rate limiter is in-process (`src/lib/ratelimit.ts`); if you
scale horizontally, move it to Redis — the call sites do not change. Everything else is stateless
and safe to scale.

Also schedule `npm run reconcile-refunds` every 10-15 minutes (cron, or your platform's scheduled
jobs). See **Refunds** below for what it does and why it exists.

## Metrics

`/admin` shows revenue, confirmed payments, claimed words, paid placements, takeovers, repeat
buyers, valid outbound clicks and average ownership value — all computed from real rows.

Three retention/liquidity rates, also computed from real rows only (`src/lib/metrics.ts`), all 0
— never `NaN` — with no data yet:

- **Repeat buyer rate** — brands with more than one confirmed ownership ÷ every distinct paying
  brand (`Owner` is one row per canonical domain, so this needs no fuzzy matching).
- **Word competition rate** — words that have changed hands at least once (a takeover or reclaim)
  ÷ every claimed word.
- **Competitive revenue share** — `competitiveSpendCents` (confirmed TAKEOVER/RECLAIM + BOOST
  revenue, excluding every word's first claim — see **Competitive proof**) ÷ confirmed revenue.

## Public attention proof

Every page's header shows `🟢 N online · N visitors · STATS →`, and `/stats` expands that into
visitors, online now, outbound clicks, words owned, takeovers, a 24-hour visitor chart, and the
most-clicked and most-valuable words. This is the whole product argument made visible: money buys
rank, rank buys real traffic — so the traffic has to be provably real.

**Every number is real, never estimated or seeded.** `src/lib/attention.ts` is the single source
of truth for how each one is defined:

- **Visitor** — a distinct long-lived cookie (`src/app/api/visit/route.ts`), set only after a
  real browser runs the heartbeat's client-side JavaScript (`VisitorHeartbeat` component). Most
  bots and crawlers never execute that at all; the ones that do are still filtered by User-Agent
  (the same `looksLikeBot` check used for click validity).
- **Online** — a visitor whose last heartbeat (fired on load, then every ~60s while the tab stays
  open) was within the last 5 minutes.
- **Most Clicked Words** uses `Word.clickCount` (a lifetime total across every owner) — the one
  deliberate exception to "clicks belong to the current ownership": this is a word-level
  attention figure, not a specific owner's performance, so it must NOT reset on takeover. Every
  other display (the leaderboard, the word page) uses the current ownership's own count, which
  does reset — see the comment on `Word.clickCount` in `prisma/schema.prisma`.

Because the header carries live data, every page in this app renders dynamically — see the
`export const dynamic = 'force-dynamic'` on `/terms` and the custom `not-found.tsx`; without it,
a page could be statically prerendered at build time and freeze a stale online/visitor count into
its HTML until the next deploy.

**What's deliberately not here:** geography, device, or browser breakdowns, and any per-owner
login-gated dashboard. This page stays public and platform-level only — the per-*ownership* view
below is a separate, smaller feature.

## Ownership analytics

Every metric here belongs to an **Ownership period**, never to a Word — the same rule the
click-attribution fix established, extended to impressions and CTR. A takeover always starts a
brand-new Ownership row at zero on every one of these; a later reclaim by the same brand creates
yet another new row, not a reuse of the old one. `src/lib/ownership-stats.ts` is the single source
of truth; `tests/ownership-stats.test.ts` proves the full claim → takeover → reclaim chain keeps
each period's numbers correctly isolated.

- **Impressions** — `POST /api/impression`, fired by `ImpressionBeacon` (mounted on the homepage
  leaderboard and on each word page) the moment a real browser actually rendered that listing.
  Bot-filtered and rate-limited the same way `/api/visit` is. Unlike clicks, impressions are
  intentionally **not** deduplicated per visitor — a reload is a genuinely new impression, same
  as any ad-impression count.
- **Unique clicks** — distinct visitor hashes among an ownership's valid clicks (the existing
  bot-filtering and per-visitor dedupe window already guard click validity; this just counts
  distinct visitors within it).
- **CTR** — `unique clicks ÷ impressions × 100`. 0 impressions is reported as 0%, never `NaN`.
- **Daily rollups** (`OwnershipDailyStat`, one row per ownership per UTC day) back the "today" /
  "last 7 days" traffic figures — an aggregate bucket table, not a per-event log, so it stays
  small regardless of traffic volume.
- **Top referrers** — the `Referer` header's hostname only (never a full URL, which could leak a
  visitor's own page path) on each valid click. **Top countries are deliberately not included** —
  there is no reliable data source for that without adding a geo-IP lookup dependency, and this
  project does not fabricate data it can't honestly measure.

Public surfaces:
- The word page's primary card stays a purchase decision only — current value, clicks delivered,
  takeover price — plus a **View performance →** link. Impressions/CTR/traffic never clutter it;
  see **Design: performance vs. the purchase decision** below for why.
- `/word/<word>/analytics` is the full "Ownership Performance" view, in priority order:
  **impressions → clicks delivered → CTR → cost per click** (spend ÷ clicks, `—` not `Infinity`
  at zero clicks), then start date, today/7-day traffic, and top referrers. It is public, not
  gated behind a login, because there is no owner authentication in this product at all (see
  **Not built**) — building one just to gate this page would be a much bigger feature than the
  page itself.

### Design: performance vs. the purchase decision

`VIEW PERFORMANCE` ("what did I get") and BOOST ("I want more visibility") are different jobs
with different moments, so they live on different surfaces instead of one page trying to be
both:

- The **word page** is the commercial surface: who owns it, what it costs to take, and — right
  under that, as an **OWNER ACTION** — the BOOST buttons, because "want more visibility" is a
  decision made *while looking at the purchase card*, not after digging into a stats page.
- `/word/<word>/analytics` is **performance only**. No BOOST button lives there anymore — mixing
  "how did I do" with "pay to do better" made that page read as an accidental checkout flow.
- Every BOOST button leads with what the owner actually **pays** — `BOOST TO #1 — PAY $40`, not
  the resulting total value — because the difference is the real decision; a $50 headline number
  hides how much of it the owner already has "banked" in the word's current value.

## Competitive proof

WordBid's whole pitch is that rank is real and contested, not decorative — these are the pieces
that make that visible, all derived from real confirmed payments, never fabricated.

- **Word history** (on every owned word's page) shows every past Ownership period — owner, what
  they paid, clicks that period earned, and CURRENT or how long ago it started. It's read
  straight off `Ownership` rows, which are never rewritten once a period ends (see **Ownership
  analytics** above), so this is immutable by construction.
- **Reclaim.** A past owner shown in that history gets a `RECLAIM FOR $X` link next to their row.
  It is the exact same `/claim` flow and price as any other takeover — no separate pricing
  engine, no special-cased "reclaim" payment path. `X` is just the word's live minimum bid;
  whoever pays it wins the word, same as always.
- **Competitive spend** (`src/lib/queries.ts#getWordCompetitiveSpend`, platform-wide version in
  `src/lib/metrics.ts`) = confirmed TAKEOVER/reclaim spend + confirmed BOOST spend, **excluding**
  every word's first claim. Shown per-word (word page), and platform-wide on `/stats` and
  `/admin`. It is read from `Payment.amountCents` directly, never `Ownership.amountCents` — a
  boost mutates its ownership's `amountCents` in place, so summing that would double-count a
  boosted ownership's takeover price together with its later boost money.
- **Post-purchase copy** distinguishes three real outcomes: a first claim ("YOU OWN X"), a
  takeover/reclaim ("YOU TOOK X"), and a boost ("X BOOSTED") — see
  `src/app/checkout/result/page.tsx` and `isFirstClaimPayment`. The share text follows the same
  split.
- **The LIVE activity feed** (homepage) shows exactly these four real events as they happen —
  `CLAIMED`, `TAKEOVER` (naming who it was taken from), `RECLAIM` (a brand honestly getting its
  own former word back, not just "another takeover"), and `BOOST` (real rank movement, `+$X`,
  never implying a change of owner). One `Activity` model, one feed — never a second, separate
  "market activity" system. See `src/lib/ownership.ts` for exactly where each type is decided and
  `src/components/ActivityFeed.tsx` for the four-way copy.

## Notifications

Optional, minimal, and never a condition of paying: after a claim/takeover/reclaim confirms
(never a boost — nobody's ownership changes), `/checkout/result` offers a one-field "🔔 GET
NOTIFIED" form. There is no login in this product, so the only thing standing in for "this is the
same buyer" is knowledge of that one payment's own unguessable id — the same trust model the
result page itself already relies on to show that payment's details to whoever loads its URL. See
`src/lib/notify-email.ts`.

When a brand that opted in later loses its word to a takeover, `confirmPayment` (still inside the
same transaction, still never touching payment/ownership correctness) prepares a notice with the
word, the new owner, the outgoing owner's real performance while they held it, and the current
reclaim price — then the webhook handler sends it, **best-effort, outside the transaction**: a
delivery failure is logged and never turns a successful payment into a failed one. A brand is
never notified about "losing" a word to itself (e.g. re-buying its own currently-active word).

Delivery is a provider interface, exactly like payments (`src/lib/payments/types.ts`):

- **`console`** (default) — logs the complete notice. No external service, no cost; a legitimate
  choice for local dev or a founder who hasn't set up email yet, not a stub.
- **`resend`** — a real email via [Resend](https://resend.com)'s plain HTTP API, called with the
  runtime's own `fetch` — **no new npm dependency**. Requires `RESEND_API_KEY` and
  `RESEND_FROM_EMAIL` (see **Environment variables**). Swapping in a different HTTP-based provider
  later is one new file implementing `NotificationProvider`, same as `stripe.ts` vs `mock.ts`.

This is deliberately the smallest version of "notify on takeover" — one email, one purpose, no
inbox, no digest, no preference center. See **Not built (deliberately)** for what's still out.

## Refunds

A payment that loses the takeover race (`confirmPayment` returns `outcome: 'lost'`) has already
captured real money. The webhook handler tries to refund it immediately, in the same request. If
that call fails — or the process dies between marking it `REFUND_PENDING` and calling the
provider — the payment is stuck with money behind it and no word.

Two ways to clear it, both calling the same `reconcileRefund` in `src/lib/refunds.ts`:

- **`/admin`** lists every `REFUND_PENDING` payment with a **Retry** button (and **Retry all**).
  Safe to click more than once — a payment that already refunded is a no-op.
- **`npm run reconcile-refunds`** does the same thing for every stuck payment, from the command
  line or a cron job. It exits non-zero if anything is still stuck afterwards, so a scheduler's
  own failure alerting picks it up without extra plumbing.

If a payment keeps failing after a retry, refund it directly in your payment provider's dashboard
and mark it in `/admin`.

## Anti-abuse

- **Word normalisation** and a reserved/prohibited list (`src/lib/word.ts`).
- **Destination URL validation** blocking non-http schemes, embedded credentials and
  internal/loopback hostnames (`src/lib/url.ts`).
- **SSRF-safe outbound fetch** (`src/lib/safe-fetch.ts`) for the one server-side request driven
  by a user-supplied URL (fetching a title/description at claim time). Text validation alone
  cannot catch a public hostname that resolves to an internal address ("DNS rebinding") — a
  domain can pass every check in `validateDestinationUrl` and still resolve to `127.0.0.1` or a
  cloud metadata endpoint. `safeFetch` uses a custom DNS lookup that rejects private/internal
  addresses at the moment a connection is actually made, not before, so the address that is
  checked is the exact address connected to.
- **Canonical brand identity.** `Owner` is keyed by domain (`www.` stripped, lowercased), not
  minted fresh per checkout — the same brand bidding on five words, or bidding again later, is
  one row. This is also what makes the repeat-buyer metric a plain count rather than a guess.
- IP rate limiting on checkout and on the admin sign-in form.
- Bot filtering and per-visitor click dedupe.
- Signature-verified, idempotent payments (see **Payment correctness** above).
- Word/brand blocking in `/admin`, including retrying a stuck refund.

## Not built (deliberately)

Accounts, subscriptions, timed auctions, categories, share-card generation, recommendations,
conversion attribution and founder analytics are all out of MVP scope. **Notifications** are the
one item that moved: a single, minimal, opt-in takeover notice now exists (see **Notifications**
above) because it directly closes the TAKEOVER → RECLAIM loop; a notification *center* — an
inbox, digests, preferences, multiple notice types — is still out, same as "complex notifications"
below.

Also deliberately not in v1.1, evaluated and set aside rather than overlooked: a Today/Weekly
leaderboard, categories, achievements, battle animations, subscriptions, AI features, complex
notifications, full owner accounts/dashboards, random ranking, rotating equal-price listings, a
DataFast-style analytics product, and any major visual redesign. None of them are blocked by a
current architecture decision — `Payment.kind` already generalises cleanly (BOOST proved that),
`Ownership` periods already carry everything a Today/Weekly view would need to re-slice by date,
and nothing here relies on ranking being anything other than a live, deterministic sort. The
reason they're not built is scope, not a wall to knock down later.

Also deliberately deferred: a reputation/"WordBid Score" system, a generic historical event
graph, and shareable viral achievement badges. Each needs either real accumulated history this
young a platform doesn't have yet — awarding a reputation score or a badge off a handful of
observations would mean fabricating confidence the data doesn't support — or new schema/API
surface that deserves its own careful pass. Trending/Rising/Hidden Gems (see "Discovery / the
attention engine" above) turned out to need no new schema at all — `Word.clickCount`,
`OwnershipDailyStat` and `RankSnapshot` already carried everything required — so they shipped;
reputation scoring is a bigger claim on less data and stayed out. None of the rest is blocked:
`RankSnapshot` is exactly the substrate reputation history would read from, and `Activity` +
`Ownership` + `Click` + `OwnershipDailyStat` + `RankSnapshot` together already are the historical
event graph — a fifth, generic "event" table logging the same facts a second time would be
duplication, not new capability.

Category discovery (`/category/<slug>`) is the one item from this pass's own request that's
still out: it needs a `Word.category` column, a category picker in `ClaimForm`, and a dynamic
route — none of it hard, but `src/lib/discovery.ts`'s query functions were written so adding a
`category` filter to each is the actual fast-follow (a `where: { category }` clause plus one new
route reusing the same `LeaderboardRow` + `LeaderboardRow` component this pass already built),
not a redesign. Distinct shareable URLs per discovery tab (`/trending`, `/rising`, `/gems`) are
the same story — currently `/?tab=`, cheap to promote to real routes later for SEO.
