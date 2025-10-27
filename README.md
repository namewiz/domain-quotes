# Domain Quotes

[![Build](https://github.com/namewiz/domain-quotes/actions/workflows/build.yml/badge.svg)](https://github.com/namewiz/domain-quotes/actions/workflows/build.yml)
[![Test](https://github.com/namewiz/domain-quotes/actions/workflows/test.yml/badge.svg)](https://github.com/namewiz/domain-quotes/actions/workflows/test.yml)
[![NPM](http://img.shields.io/npm/v/domain-quotes.svg)](https://www.npmjs.com/package/domain-quotes)
[![License](https://img.shields.io/npm/l/domain-quotes.svg)](https://github.com/namewiz/domain-quotes/blob/main/LICENSE)


Domain Quote is a lightweight TypeScript/JavaScript library to compute domain registration quotes across currencies with discounts and VAT, using curated datasets.

Includes:
- Extension support based on unified registrar price list (OpenProvider/NIRA)
- Currency conversion via remote exchange rates
- VAT calculation per currency (US, GB, DE, NG mapping)
- Optional discount codes with max-or-stack policy
- Configurable markup to increase base prices before taxes/discounts
- Clean ESM API with TypeScript types

Install

```bash
npm i domain-quotes
```

Usage

```ts
import { getDefaultQuote, DomainPrices, DEFAULT_RATES } from 'domain-quotes';

// Quick quote (uses bundled defaults)
const quote = await getDefaultQuote('com', 'USD', { discountCodes: ['SAVE10'] });
// → { extension, currency, basePrice, discount, tax, totalPrice, symbol }

// Advanced: custom or explicit config via the class
const dp = new DomainPrices(DEFAULT_RATES); // or provide your own DomainPricesConfig
const eur = await dp.getPrice('example.com', 'EUR', { discountPolicy: 'stack' });

// Add a 15% markup before discounts/taxes
const withMarkup = new DomainPrices({
  ...DEFAULT_RATES,
  markup: { type: 'percentage', value: 0.15 },
});
const quoteWithMarkup = await withMarkup.getPrice('example.com', 'USD', { discountCodes: ['SAVE10'] });
```

API

- `getDefaultQuote(extension: string, currency: string, options?: GetPriceOptions): Promise<PriceQuote>`
  - Computes a quote for a TLD/SLD extension (e.g. `com`, `com.ng`, `.org`) using the bundled defaults.
  - Alias: `getDefaultPrice(...)` for backward-compatibility.
  - `options`
    - `discountCodes?: string[]` – one or more codes; case-insensitive.
    - `now?: number | Date` – inject time for deterministic tests.
    - `discountPolicy?: 'stack' | 'max'` – default `'max'` (highest single discount only).

- `class DomainPrices(config: DomainPricesConfig)`
  - `getPrice(extension: string, currency: string, options?: GetPriceOptions): Promise<PriceQuote>` – same behavior as above, but uses the provided config. Alias: `getQuote(...)`.
  - `DEFAULT_RATES: DomainPricesConfig` – exported snapshot config used by `getDefaultQuote`.

- `listSupportedExtensions(): string[]`
  - All extensions with a non-zero price in the dataset.

- `isSupportedExtension(extOrDomain: string): boolean`
  - Accepts an extension or a full domain (resolved by longest-known suffix match against bundled price data).

- `listSupportedCurrencies(): string[]`
  - Currently returns `['USD','GBP','EUR','NGN']`. These map to VAT via country ISO codes.

- `isSupportedCurrency(code: string): boolean`

Types

```ts
type DiscountPolicy = 'stack' | 'max';

interface GetPriceOptions {
  discountCodes?: string[];
  now?: number | Date;
  discountPolicy?: DiscountPolicy;
  transaction?: 'create' | 'renew' | 'restore' | 'transfer'; // default 'create'
}

type MarkupType = 'percentage' | 'fixed_usd';

interface PriceMarkup {
  type: MarkupType;            // percentage -> 0.2 === +20%, fixed_usd -> +$ value before conversion
  value: number;
}

interface PriceQuote {
  extension: string;
  currency: string;
  basePrice: number;
  discount: number;
  tax: number;
  totalPrice: number;
  symbol: string;
  transaction: 'create' | 'renew' | 'restore' | 'transfer';
}

interface ExchangeRateData {
  countryCode: string;
  currencyName: string;
  currencySymbol: string;
  currencyCode: string;
  exchangeRate: number;
  inverseRate: number;
}

interface DiscountConfig {
  rate: number; // e.g. 0.1 for 10%
  extensions: string[]; // eligible extensions
  startAt: string; // ISO timestamp
  endAt: string;   // ISO timestamp
}

interface DomainPricesConfig {
  createPrices: Record<string, number>;        // base USD prices for create
  // Optional price tables per transaction type (all USD). Falls back to `createPrices` when absent.
  renewPrices?: Record<string, number>;
  restorePrices?: Record<string, number>;
  transferPrices?: Record<string, number>;
  exchangeRates: ExchangeRateData[];           // currency conversion data
  vatRate: number;                             // single VAT rate applied to subtotal
  discounts: Record<string, DiscountConfig>;   // discount code → config
  markup?: PriceMarkup;                        // optional markup applied before conversion
}
```

Errors

- `UnsupportedExtensionError` with `code = 'ERR_UNSUPPORTED_EXTENSION'`
- `UnsupportedCurrencyError` with `code = 'ERR_UNSUPPORTED_CURRENCY'`

Notes

- Rounding is to 2 decimal places at each step to keep totals predictable (`base`, `discount`, `tax`, `total`).
- A single VAT rate is applied to the subtotal by default (7.5% in the default config). Override `vatRate` in the config to change it.
- Price and exchange-rate data are fetched from maintained remote sources at import time:
  - Prices: `https://raw.githubusercontent.com/namewiz/registrar-pricelist/refs/heads/main/data/unified-create-prices.csv`
  - Exchange rates: `https://raw.githubusercontent.com/namewiz/registrar-pricelist/refs/heads/main/data/exchange-rates.json`
  These are cached in-memory for the life of the process.

## Testing

```bash
npm test
```

The test suite uses Node’s built-in `node:test` runner and builds the library first.
