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
| `PAYMENT_PROVIDER` | no | `mock` | `stripe` or `mock`. **`mock` is refused in production** unless `ALLOW_MOCK_PAYMENTS=true` |
| `STRIPE_SECRET_KEY` | with Stripe | — | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | with Stripe | — | Signing secret for the webhook endpoint |
| `STRIPE_CURRENCY` | no | `usd` | Checkout currency |
| `STARTING_PRICE_CENTS` | no | `1000` | Price of an unclaimed word ($10) |
| `TAKEOVER_INCREMENT_PERCENT` | no | `5` | Minimum premium to take an owned word |
| `MAX_AMOUNT_CENTS` | no | `10000000` | Ceiling on a single claim ($100,000) |
| `CLICK_DEDUPE_WINDOW_SECONDS` | no | `1800` | Repeat clicks by one visitor inside this window are not counted |

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
- The word page shows **Clicks delivered**, **Impressions**, and **CTR** for the current
  ownership, plus a **View analytics →** link.
- `/word/<word>/analytics` is the full "Ownership Performance" view — impressions, unique clicks,
  CTR, current value, start date, today/7-day traffic, and top referrers. It is public, not
  gated behind a login, because there is no owner authentication in this product at all (see
  **Not built**) — building one just to gate this page would be a much bigger feature than the
  page itself.

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

Accounts, subscriptions, timed auctions, categories, notifications, share-card generation,
recommendations, conversion attribution and founder analytics are all out of MVP scope.

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
