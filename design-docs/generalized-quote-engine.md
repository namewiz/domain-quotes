# Generalized Quote Engine

**Status:** Draft / for review
**Date:** 2026-07-15
**Supersedes:** the domain-only design in `src/index.ts` (v0.4.4)

## Goal

Turn `domain-quotes` from a domain-registration price calculator into a general quote
engine that works for any product type — domains, software licences, physical goods,
services — while keeping the domain behaviour available as a first-class preset.

A client should be able to describe a product, its variants, its prices, and its tax
treatment in config, then ask for a quote in a given currency, interval, and quantity,
and get back a price object that is *also smart*: it surfaces when a different but
equivalent purchase shape (annual instead of monthly, 5 units instead of 1) would cost
less.

Two decisions are already made and this plan assumes them:

- **One package, v1 major.** The generic engine lives here. Domains ship as a built-in
  preset. Today's exports (`getDefaultQuote`, `DomainQuotes`, `DEFAULT_CONFIG`) survive
  as a deprecated shim over the core for one major version.
- **Lazy, injectable data loading.** The core does no I/O at all. The domains preset owns
  the registrar CSV/FX fetch, lazily on first use and injectable for tests. Importing the
  library will no longer touch the network.

## Non-goals

Worth naming, because the gravitational pull of "generalize the pricing library" is to
reinvent Stripe:

- Not an invoicing or payments system. No invoice objects, no payment state, no dunning.
- No proration, mid-cycle upgrades, or subscription lifecycle state. The engine prices a
  hypothetical purchase; it doesn't know what the customer already owns.
- No tax compliance. It applies tax rules it is handed. It does not determine nexus,
  validate VAT IDs, or maintain a jurisdiction registry.
- No live FX. Rates are data passed in, exactly as today.
- No persistence, no catalog CRUD, no admin UI.

## Where we are today

The engine buried in `getQuote` is already the right shape — resolve a price, apply
markup, apply discounts, apply tax, round — but every axis is hardcoded to domains. The
inventory, and what each becomes:

| Today | Generalizes to |
| --- | --- |
| `extension: string` | `sku: string`, with a preset-supplied `normalizeSku` hook |
| `normalizeExtension` (strip dots, lowercase) | moves into the domains preset |
| `TransactionType` = `create\|renew\|restore\|transfer` | open `variant: string` |
| `createPrices` / `renewPrices` / `restorePrices` / `transferPrices` | one `PriceRule[]` with a `variant` selector |
| `createProviders` (registrar attribution) | `metadata` on the product / resolved rule |
| `vatRate: number` (flat 7.5%) | `TaxRule[]` plus an optional `TaxResolver` |
| `markup.fixedUsd` | `markup.fixed: Money` in any currency; base currency is config |
| `supportedCurrencies: ['USD','NGN']` | `currencies: CurrencyMeta[]` |
| `allowFractionalAmounts: boolean` | per-currency `roundingIncrement` |
| CSV/FX fetch at module load (top-level await) | preset `load()`, lazy and injectable |
| `UnsupportedExtensionError` | `UnknownSkuError` (see note on `tasks.yml` below) |
| `Quote.domainTransaction` | `Quote.variant` |
| implicit 1 year, 1 unit | explicit `interval`, `term`, `quantity` |

Three things stay generic and survive largely intact: the FX conversion path, the
markup/discount/tax pipeline order, and the discount eligibility model (date window,
selector filters, custom callback).

### Folding in the open tasks

`tasks.yml` has three pending tasks that this rewrite touches directly. They should land
as part of it rather than before it:

- **Task 1 (meta constraints: domain pattern, email domain, country code)** is already
  marked `ignoreTask` on the grounds that the `isEligible` callback covers it. The
  generic model makes that argument stronger: `QuoteRequest.context` carries arbitrary
  caller data (email, country, referrer) through to eligibility callbacks, so corporate
  and geo discounts need no new first-class fields. Keep it closed.
- **Task 2 (replace `DomainQuoteError` with native errors)** should be decided as part of
  the v1 error surface rather than done twice. My recommendation is the opposite of the
  task: keep a small typed error hierarchy with stable `code` values, because a library
  whose whole job is being embedded in checkout flows benefits from callers branching on
  `err.code` without string-matching messages. Worth an explicit call.
- **Task 3 (total strictly > 0)** becomes a config knob, not a hard rule. A generic
  engine will legitimately quote zero for free tiers and 100%-off promotions. Model it as
  `minChargeableTotal?: Money` (domains preset sets it above zero), and clamp discounts to
  the subtotal so the total can never go negative.

## The model

### Products and variants

A product is a thing you can buy, identified by a SKU. A variant is a *mode* of buying
that same product — `create`, `renew`, `restore`, `transfer` for a domain; `new`,
`upgrade`, `renewal`, `academic` for software; `standard` vs `expedited` for a service.

```ts
interface Product {
  sku: string;
  name?: string;
  groups?: string[];              // tags for bulk rules, e.g. 'gtld', 'cctld'
  variants: Variant[];
  intervals?: Interval[];         // which are purchasable
  metadata?: Record<string, unknown>;  // e.g. { provider: 'openprovider' }
}

interface Variant {
  id: string;
  substitutionGroup?: string;     // see "comparability" below — default: none
  requires?: EligibilityCallback; // e.g. academic pricing needs a .edu address
}
```

### The three axes

The request conflates concepts that need separating. "Buying more" means three different
things, and savings can come from any of them independently:

1. **`interval`** — the billing unit: `once`, `day`, `week`, `month`, `year`. Comparing
   *across* intervals is the "annual plan beats monthly × 12" case.
2. **`term`** — how many intervals are being bought at once. A 2-year domain registration
   is `interval: year, term: 2`. Per-interval price often drops as term rises.
3. **`quantity`** — how many units. 5 seats, 3 domains. Per-unit price often drops as
   quantity rises.

Pre-tax subtotal is `unitPrice × quantity × term`, modulo tier pricing on either axis.
Today's library implicitly hardcodes all three (`year`, `1`, `1`).

### Price rules

Rather than one table per transaction type, prices become a flat list of rules with
optional selectors. Omitted selector = matches anything.

```ts
interface PriceRule {
  // selectors
  sku?: string | string[];
  group?: string;
  variant?: string | string[];
  interval?: IntervalUnit;
  minQuantity?: number;  maxQuantity?: number;   // volume tiers
  minTerm?: number;      maxTerm?: number;       // term tiers
  // payload
  amount: Money | Record<string, number>;        // per currency, as today
  per?: 'unit' | 'line';                         // default 'unit'
}
```

Resolution picks the most specific match, by an explicit precedence ladder rather than
magic specificity weights:

1. exact `sku` beats `group` beats wildcard
2. narrower quantity range beats wider
3. narrower term range beats wider
4. explicit `variant` beats wildcard
5. explicit `interval` beats wildcard
6. declaration order — later wins

The rule that won is reported in `quote.explain.matchedRule`. A flexible matcher without
an explanation trail is a support burden; this is not optional.

### Tax

Flat `vatRate` becomes rules, with a resolver escape hatch for anything real-world:

```ts
interface TaxRule {
  id: string;
  name: string;                   // 'VAT', 'GST', 'PST'
  rate: number;
  jurisdiction?: string;
  appliesTo?: { skus?: string[]; groups?: string[]; variants?: string[] };
  inclusive?: boolean;            // price already contains the tax
  compound?: boolean;             // stacks on top of prior taxes, not on the base
  basis?: 'subtotal' | 'base';    // default 'subtotal' (post-discount) — today's behaviour
}

type TaxResolver = (ctx: TaxContext) => TaxRule[] | Promise<TaxRule[]>;
```

The domains preset defaults to `[{ id: 'vat', name: 'VAT', rate: 0.075 }]`, preserving
today's result. Output carries `taxes: TaxLine[]` so a caller can itemize, plus a summed
`tax` for the common case.

### Money and rounding

The current code does float math and `Number(n.toFixed(2))` at each step, with an
`allowFractionalAmounts` flag that exists because naira are quoted in whole units. Both
generalize badly — JPY has no minor unit, KWD has three.

- Represent money as integer minor units: `{ currency: 'USD', minor: 1299 }`.
- Carry per-currency metadata: `{ code, symbol, exponent, roundingIncrement? }`.
  `allowFractionalAmounts: false` becomes NGN's `roundingIncrement: 100` (whole naira) —
  a real currency policy instead of a global boolean.
- Do intermediate math (FX especially) at extra precision and quantize only at defined
  boundaries: after markup, after discount, after each tax line.
- Keep `roundingPolicy: 'per-step' | 'final'` so the legacy shim can reproduce 0.4.x
  output exactly.

## The smart layer

This is the genuinely new part, and the part most likely to go wrong.

### Comparability is the hard problem, not the arithmetic

The naive version — price every alternative, report anything cheaper — produces confident
nonsense. `renew` is cheaper than `create`, but suggesting "renew instead" to someone
registering a new domain is not a saving, it's a category error. `standard` is cheaper
than `pro`, but they aren't the same product.

So the engine only compares configurations that deliver **the same value, differing only
in amount**. In practice:

- **`interval`, `term`, and `quantity` are safely comparable by default.** More of the
  same thing is still the same thing.
- **Variants are NOT comparable by default.** A variant only enters the comparison set if
  config explicitly declares it substitutable via `substitutionGroup`. The domains preset
  declares no groups, so lifecycle variants are never cross-suggested. This default is the
  single most important safety property of the feature.

### Honest counterfactuals

Comparing an annual plan to a monthly one assumes the customer keeps it for a year. That
is an assumption, not a fact, and the output must say so rather than quietly bake it in.

- Comparison happens over an explicit **horizon** (`horizonDays`), defaulting to the
  longest candidate's duration.
- Every insight carries `assumes: string[]` — e.g. `["you keep this for 365 days"]` — so
  the client can render the caveat.
- When the horizon isn't a clean multiple of the candidate's duration, the customer buys
  *more than they asked for*. A 3-year registration compared over a 1-year horizon is not
  a like-for-like saving. Flag it as `providesExtra` and report both the horizon-normalized
  cost and what is actually purchased.
- Normalization uses fixed average durations (`year = 365.2425d`, `month = 30.436875d`)
  because this is rate math, not invoice scheduling. Deterministic, and documented.

### Two classes of saving

- **Dominant** — the alternative costs less *in absolute terms* than what was asked for.
  Buying 5 units at the tier price totals less than 1 unit at list. Rare, and always worth
  surfacing loudly.
- **Rate** — the alternative costs more absolutely but less per unit per day. The standard
  annual-plan upsell. Worth surfacing, but honestly framed.

Plus a near-miss case: **`tier-threshold`**, where adding one or two units crosses into a
cheaper bracket.

### Shape

```ts
interface Insight {
  kind: 'interval-upgrade' | 'term-upgrade' | 'volume-tier'
      | 'tier-threshold' | 'variant-swap' | 'discount-available';
  strength: 'dominant' | 'strong' | 'info';
  alternative: ResolvedRequest;
  quote: Quote;                  // the fully priced counterfactual
  savings: {
    currency: string;
    amount: Money;
    percent: number;
    horizonDays: number;
    baselineCost: Money;
    alternativeCost: Money;
  };
  dominant: boolean;
  providesExtra?: { term?: number; quantity?: number };
  assumes: string[];
}
```

Core returns structured data only. Message formatting stays out of core — a
`formatInsight()` helper ships alongside, and i18n is the caller's problem.

### Cost control

Exploration prices N extra quotes and may re-run caller-supplied async eligibility
callbacks N times. That has to be bounded:

- **Opt-in.** `quote(req)` prices one thing. `quote(req, { explore: true })` does the
  counterfactual work.
- Candidates come only from what the catalog actually declares — real tier breakpoints and
  real purchasable intervals — never a synthesized sweep.
- `maxCandidates` (default 24) with deterministic ordering; `minSavingsPercent` (default
  1%) to suppress noise.
- Discount eligibility results are memoized per `quote()` call. This makes `isEligible`
  contractually side-effect-free — a documented behaviour change worth calling out, since
  today it runs exactly once.

```ts
interface ExploreOptions {
  intervals?: boolean | IntervalUnit[];
  terms?: boolean | number[];
  quantities?: boolean | number[];
  variants?: boolean;            // only honours declared substitution groups
  horizonDays?: number;
  maxCandidates?: number;
  minSavingsPercent?: number;
}
```

## Architecture

```
src/
  core/
    money.ts       — minor-unit arithmetic, rounding policy, currency metadata
    currency.ts    — FX resolution and conversion
    interval.ts    — interval durations, horizon normalization
    catalog.ts     — product/variant/rule resolution + precedence ladder
    pricing.ts     — the pipeline: resolve → markup → discount → tax → round
    insights.ts    — counterfactual enumeration and comparison
    errors.ts
    types.ts
  presets/
    domains/       — TLD normalization, registrar CSV loader, FX, VAT default
    software/      — seats, plans, term tiers
  legacy.ts        — deprecated shim: DomainQuotes, getDefaultQuote, DEFAULT_CONFIG
  index.ts
```

The invariant that keeps this honest: **`core/` imports nothing from `presets/`, and does
no I/O.** It takes in-memory catalogs and returns quotes. Every domain-shaped assumption
lives behind the preset boundary.

## API sketch

```ts
import { Quotes } from 'quotes';
import { domainsPreset } from 'quotes/presets/domains';

const preset = domainsPreset({ fetch: customFetch });  // injectable
await preset.load();                                    // explicit, lazy, not at import

const q = new Quotes(preset.config);

const quote = await q.quote({
  sku: 'com',
  variant: 'create',
  interval: { unit: 'year' },
  term: 1,
  quantity: 1,
  currency: 'NGN',
  discountCodes: ['WELCOME'],
  context: { email: 'a@acme.com', country: 'NG' },  // forwarded to eligibility callbacks
}, { explore: true });

quote.total;        // { currency: 'NGN', minor: 2150000 }
quote.rate;         // per unit per day/month/year
quote.explain;      // matched rule, FX rate, rounding steps
quote.insights;     // [{ kind: 'term-upgrade', savings: {...}, assumes: [...] }]
```

And the same core, no domain knowledge, for software:

```ts
const q = new Quotes({
  products: [{
    sku: 'pro',
    variants: [{ id: 'subscription' }],
    intervals: [{ unit: 'month' }, { unit: 'year' }],
  }],
  rules: [
    { sku: 'pro', interval: 'month', amount: { USD: 10 } },
    { sku: 'pro', interval: 'year',  amount: { USD: 100 } },   // 2 months free
    { sku: 'pro', minQuantity: 5,    amount: { USD: 8 } },
  ],
  currencies: [USD],
  taxes: [],
});
// quote(month × 1) with explore → interval-upgrade insight: save $20/yr (16.7%)
```

## Migration

Sequenced so that each phase is independently reviewable and the library stays shippable
throughout.

**Phase 0 — characterize.** Before touching anything, capture current behaviour as golden
tests: the full TLD × currency × transaction matrix, output snapshotted from 0.4.4. This
is the safety net for every later phase, and it's cheap now while the old code still runs.

**Phase 1 — extract the core, no behaviour change.** Money/rounding/FX/interval modules.
Domain preset reproduces current output byte-for-byte against the Phase 0 goldens. Data
loading moves to lazy+injectable — the first user-visible change, and the one that makes
everything after it testable offline.

**Phase 2 — the axes.** Introduce `interval`, `term`, `quantity`, and the price-rule
matcher with its precedence ladder. Domains keep defaulting to `year / 1 / 1`, so goldens
still pass.

**Phase 3 — tax generalization.** `TaxRule[]` + resolver. Flat 7.5% VAT becomes a
one-element default in the preset.

**Phase 4 — the smart layer.** Insights engine behind `explore`. Substitution groups,
horizon normalization, dominance classification, caps.

**Phase 5 — prove and ship.** Build the software preset *for real*, not as a doc example.
Then rewrite the README around the generic API, ship `legacy.ts` with deprecation
warnings, and cut v1.

Phase 5's ordering is deliberate. An abstraction validated by exactly one consumer is
usually just that consumer's shape with the names filed off. The software preset is how we
find out whether this design is actually general before we commit to it in a major
version — and it should be allowed to send us back to Phase 2.

## Open questions

1. **Package name.** `domain-quotes` is a poor name for a general engine, but it has npm
   history and inbound links. Rename to `quotes`/`price-quotes` and deprecate the old
   name, or keep the name and accept the mismatch? Rename to price-quotes.
2. **Error surface.** Keep typed errors with stable codes (my recommendation, contra
   `tasks.yml` task 2) or move to native `Error`? Keep typed errors
3. **`isEligible` purity.** Memoization makes side-effect-free callbacks a contract. Is
   that acceptable for existing consumers, or does exploration need a way to opt out of
   re-running discounts entirely?
4. **Is `once` comparable to recurring?** A perpetual licence versus a subscription is
   arguably a savings comparison, but it has no natural horizon. Require an explicit
   `horizonDays` before emitting that insight, or refuse to compare them at all? Don't compare.
5. **How much config ergonomics?** A raw `PriceRule[]` is flexible and verbose. Worth a
   typed `defineCatalog()` builder in v1, or defer? Defer.

## Risks

- **Over-generalizing on one example.** Mitigated by Phase 5 landing a second real preset,
  with license to reopen earlier phases.
- **Insight nonsense.** Mitigated by variants being non-comparable by default — the
  conservative default is the whole safety story, and it should not be relaxed casually.
- **Rounding regressions.** Moving to minor units will shift some totals by a unit.
  Mitigated by Phase 0 goldens; any intentional diff gets recorded there explicitly.
- **Exploration cost.** Mitigated by opt-in, catalog-derived candidates, caps, memoization.
- **Config complexity scaring off simple users.** Mitigated by presets: the domain
  three-liner has to stay a three-liner.
