# DomainPrices

[![Build](https://github.com/namewiz/domainprices/actions/workflows/build.yml/badge.svg)](https://github.com/namewiz/domainprices/actions/workflows/build.yml)
[![Test](https://github.com/namewiz/domainprices/actions/workflows/test.yml/badge.svg)](https://github.com/namewiz/domainprices/actions/workflows/test.yml)
[![NPM](http://img.shields.io/npm/v/domainprices.svg)](https://www.npmjs.com/package/domainprices)
[![License](https://img.shields.io/npm/l/domainprices.svg)](https://github.com/namewiz/domainprices/blob/main/LICENSE)


DomainPrices is a lightweight TypeScript/JavaScript library to compute domain registration prices across currencies with discounts and VAT, using curated datasets.

Includes:
- Extension support based on OpenProvider price data
- Currency conversion via baked-in exchange rates
- VAT calculation per currency (US, GB, DE, NG mapping)
- Optional discount codes with max-or-stack policy
- Clean ESM API with TypeScript types

Install

```bash
npm i domainprices
```

Usage

```ts
import { getDefaultPrice, DomainPrices, DEFAULTS_Sept2025 } from 'domainprices';

// Quick price (uses bundled defaults)
const quote = await getDefaultPrice('com', 'USD', { discountCodes: ['SAVE10'] });
// → { extension, currency, basePrice, discount, tax, totalPrice, symbol }

// Advanced: custom or explicit config via the class
const dp = new DomainPrices(DEFAULTS_Sept2025); // or provide your own DomainPricesConfig
const eur = await dp.getPrice('example.com', 'EUR', { discountPolicy: 'stack' });
```

API

- `getDefaultPrice(extension: string, currency: string, options?: GetPriceOptions): Promise<PriceQuote>`
  - Computes price for a TLD/SLD extension (e.g. `com`, `com.ng`, `.org`) using the bundled defaults.
  - `options`
    - `discountCodes?: string[]` – one or more codes; case-insensitive.
    - `now?: number | Date` – inject time for deterministic tests.
    - `discountPolicy?: 'stack' | 'max'` – default `'max'` (highest single discount only).

- `class DomainPrices(config: DomainPricesConfig)`
  - `getPrice(extension: string, currency: string, options?: GetPriceOptions): Promise<PriceQuote>` – same behavior as above, but uses the provided config.
  - `DEFAULTS_Sept2025: DomainPricesConfig` – exported snapshot config used by `getDefaultPrice`.

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
}

interface PriceQuote {
  extension: string;
  currency: string;
  basePrice: number;
  discount: number;
  tax: number;
  totalPrice: number;
  symbol: string;
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
  prices: Record<string, number>;              // base USD prices keyed by extension
  exchangeRates: ExchangeRateData[];           // currency conversion data
  vatRates: Record<string, number>;            // ISO country code → VAT rate
  discounts: Record<string, DiscountConfig>;   // discount code → config
}
```

Errors

- `UnsupportedExtensionError` with `code = 'ERR_UNSUPPORTED_EXTENSION'`
- `UnsupportedCurrencyError` with `code = 'ERR_UNSUPPORTED_CURRENCY'`

Notes

- Rounding is to 2 decimal places at each step to keep totals predictable (`base`, `discount`, `tax`, `total`).
- VAT mapping is intentionally narrow and explicit by currency → country: `USD → US (0)`, `GBP → GB (0.2)`, `EUR → DE (0.19)`, `NGN → NG (0.075)`.
- Exchange rates and price tables are bundled static JSON.

## Testing

```bash
npm test
```

The test suite uses Node’s built-in `node:test` runner and builds the library first.
