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
import { getPrice } from 'domainprices';

// Extension-based
const quote = await getPrice('com', 'USD');
// { extension: 'com', currency: 'USD', basePrice, discount, tax, totalPrice, symbol }
```

API

- `getPrice(extension: string, currency: string, options?: GetPriceOptions): Promise<PriceQuote>`
  - Computes price for a TLD/SLD extension (e.g. `com`, `com.ng`, `.org`).
  - `options`
    - `discountCodes?: string[]` – one or more codes; case-insensitive.
    - `now?: number | Date` – inject time for deterministic tests.
    - `discountPolicy?: 'stack' | 'max'` – default `'max'` (highest single discount only).

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
