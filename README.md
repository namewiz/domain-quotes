# Domain Quotes

[![Build](https://github.com/namewiz/domain-quotes/actions/workflows/build.yml/badge.svg)](https://github.com/namewiz/domain-quotes/actions/workflows/build.yml)
[![Test](https://github.com/namewiz/domain-quotes/actions/workflows/test.yml/badge.svg)](https://github.com/namewiz/domain-quotes/actions/workflows/test.yml)
[![NPM](http://img.shields.io/npm/v/domain-quotes.svg)](https://www.npmjs.com/package/domain-quotes)
[![License](https://img.shields.io/npm/l/domain-quotes.svg)](https://github.com/namewiz/domain-quotes/blob/main/LICENSE)


Domain Quote is a lightweight TypeScript/JavaScript library to compute domain registration quotes across currencies with discounts and VAT, using curated datasets.

Includes:
- Extension support based on unified registrar price list (OpenProvider/NIRA)
- Currency conversion via remote exchange rates
- VAT calculation with configurable rate
- Flexible discount system with date ranges, extension/transaction filtering, and custom eligibility callbacks
- Configurable markup to increase base prices before taxes/discounts
- Extension normalization (`.com` and `com` are treated identically)
- Clean ESM API with TypeScript types

## Install

```bash
npm i domain-quotes
```

## Usage

```ts
import { getDefaultQuote, DomainQuotes, DEFAULT_CONFIG } from 'domain-quotes';

// Quick quote (uses bundled defaults, no discounts configured by default)
const quote = await getDefaultQuote('com', 'USD');
// → { extension, currency, basePrice, discount, tax, totalPrice, symbol, domainTransaction }

// Extensions are normalized - leading dots are stripped
const quote2 = await getDefaultQuote('.com', 'USD'); // same as 'com'

// Custom config with discounts
const dq = new DomainQuotes({
  ...DEFAULT_CONFIG,
  discounts: {
    SAVE10: {
      rate: 0.1, // 10% discount
      extensions: ['com', 'net', 'org'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  },
});
const discounted = await dq.getQuote('com', 'USD', { discountCodes: ['SAVE10'] });

// Add a 15% markup before discounts/taxes
const withMarkup = new DomainQuotes({
  ...DEFAULT_CONFIG,
  markup: { type: 'percentage', value: 0.15 },
});
const quoteWithMarkup = await withMarkup.getQuote('com', 'USD');
```

## Discounts

Discounts are configured via the `discounts` field in `DomainQuoteConfig`. Each discount can be filtered by:

- **Date range**: `startAt` and `endAt` (ISO timestamps)
- **Extensions**: List of eligible extensions (normalized, so `.com` and `com` are equivalent)
- **Transaction types**: Optional list of transaction types (`create`, `renew`, `restore`, `transfer`)
- **Custom eligibility**: Optional callback for complex eligibility logic

```ts
const dq = new DomainQuotes({
  ...DEFAULT_CONFIG,
  discounts: {
    // Basic discount
    WELCOME: {
      rate: 0.1,
      extensions: ['com', 'net'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },

    // Discount limited to specific transaction types
    NEWUSER: {
      rate: 0.2,
      extensions: ['com', 'net', 'org'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      transactions: ['create'], // Only applies to new registrations
    },

    // Discount with custom eligibility callback
    BIGSPENDER: {
      rate: 0.25,
      extensions: ['com', 'net', 'org'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      isEligible: (ctx) => ctx.basePrice >= 50, // Only if base price >= $50
    },

    // Async eligibility (e.g., check external service)
    VIP: {
      rate: 0.3,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      isEligible: async (ctx) => {
        // Check if user is VIP via external service
        const isVip = await checkVipStatus(ctx.discountCode);
        return isVip;
      },
    },
  },
});

// Apply discounts
const quote = await dq.getQuote('com', 'USD', {
  discountCodes: ['WELCOME', 'NEWUSER'],
  discountPolicy: 'max', // default: use highest discount
});

// Stack multiple discounts
const stacked = await dq.getQuote('com', 'USD', {
  discountCodes: ['WELCOME', 'NEWUSER'],
  discountPolicy: 'stack', // sum all applicable discounts
});
```

### Eligibility Callback Context

The `isEligible` callback receives a context object with:

```ts
interface DiscountEligibilityContext {
  extension: string;        // Normalized extension (e.g., 'com')
  currency: string;         // Currency code (e.g., 'USD')
  transaction: TransactionType; // Transaction type
  basePrice: number;        // Base price before discount
  discountCode: string;     // The discount code being evaluated
}
```

The callback is only invoked after all other criteria (date range, extension, transaction type) are satisfied. If the callback throws an error, the discount is skipped.

## API

### Functions

- **`getDefaultQuote(extension, currency, options?): Promise<Quote>`**

  Computes a quote using bundled defaults (no discounts configured by default).

  ```ts
  const quote = await getDefaultQuote('com', 'USD');
  const withOptions = await getDefaultQuote('.ng', 'NGN', {
    discountCodes: ['SAVE10'],
    transaction: 'renew',
  });
  ```

- **`normalizeExtension(extension: string): string`**

  Normalizes an extension by trimming whitespace, lowercasing, and removing leading dots.

  ```ts
  normalizeExtension('.COM')   // → 'com'
  normalizeExtension('..ng')   // → 'ng'
  normalizeExtension('  org ') // → 'org'
  ```

- **`listSupportedExtensions(): string[]`**

  Returns all extensions with pricing data.

- **`isSupportedExtension(extension: string): boolean`**

  Checks if an extension is supported (normalizes input).

- **`listSupportedCurrencies(): string[]`**

  Returns supported currencies (default: `['USD', 'NGN']`).

- **`isSupportedCurrency(code: string): boolean`**

  Checks if a currency is supported (case-insensitive).

### Class

- **`new DomainQuotes(config: DomainQuoteConfig)`**

  Creates a quote calculator with custom configuration.

  ```ts
  const dq = new DomainQuotes({
    ...DEFAULT_CONFIG,
    vatRate: 0.2,
    supportedCurrencies: ['USD', 'NGN', 'EUR', 'GBP'],
    discounts: { /* ... */ },
  });

  const quote = await dq.getQuote('com', 'EUR', options);
  ```

### Constants

- **`DEFAULT_CONFIG: DomainQuoteConfig`**

  The default configuration with remote pricing data, 7.5% VAT, and no discounts.

- **`DEFAULT_VAT_RATE`** = `0.075` (7.5%)

## Types

```ts
type TransactionType = 'create' | 'renew' | 'restore' | 'transfer';
type DiscountPolicy = 'stack' | 'max';
type MarkupType = 'percentage' | 'fixedUsd';

interface GetQuoteOptions {
  discountCodes?: string[];          // Discount codes to apply (case-insensitive)
  now?: number | Date;               // Override current time for testing
  discountPolicy?: DiscountPolicy;   // 'max' (default) or 'stack'
  transaction?: TransactionType;     // default: 'create'
}

interface Quote {
  extension: string;                 // Normalized extension
  currency: string;                  // Currency code
  basePrice: number;                 // Price before discount
  discount: number;                  // Total discount amount
  tax: number;                       // Tax amount
  totalPrice: number;                // Final price (basePrice - discount + tax)
  symbol: string;                    // Currency symbol
  domainTransaction: TransactionType; // Transaction type
}

interface Markup {
  type: MarkupType;                  // 'percentage' or 'fixedUsd'
  value: number;                     // 0.2 = +20%, or fixed USD amount
}

interface DiscountEligibilityContext {
  extension: string;
  currency: string;
  transaction: TransactionType;
  basePrice: number;
  discountCode: string;
}

type DiscountEligibilityCallback =
  (context: DiscountEligibilityContext) => boolean | Promise<boolean>;

interface DiscountConfig {
  rate: number;                      // e.g., 0.1 for 10%
  extensions: string[];              // Eligible extensions (normalized)
  startAt: string;                   // ISO timestamp
  endAt: string;                     // ISO timestamp
  transactions?: TransactionType[];  // Limit to specific transaction types
  isEligible?: DiscountEligibilityCallback; // Custom eligibility logic
}

interface ExchangeRateData {
  countryCode: string;
  currencyName: string;
  currencySymbol: string;
  currencyCode: string;
  exchangeRate: number;
  inverseRate: number;
}

type PriceEntry = number | Record<string, number>;
type PriceTable = Record<string, PriceEntry>;

interface DomainQuoteConfig {
  createPrices: PriceTable;                    // Base prices for create
  renewPrices?: PriceTable;                    // Optional prices for renew
  restorePrices?: PriceTable;                  // Optional prices for restore
  transferPrices?: PriceTable;                 // Optional prices for transfer
  exchangeRates: ExchangeRateData[];           // Currency conversion data
  vatRate: number;                             // VAT rate (e.g., 0.075 for 7.5%)
  discounts: Record<string, DiscountConfig>;   // Discount configurations
  markup?: Markup;                             // Optional markup
  supportedCurrencies?: string[];              // Allowed currencies (default: ['USD', 'NGN'])
}
```

## Errors

- **`UnsupportedExtensionError`** - `code: 'ERR_UNSUPPORTED_EXTENSION'`
- **`UnsupportedCurrencyError`** - `code: 'ERR_UNSUPPORTED_CURRENCY'`

```ts
import { UnsupportedExtensionError, UnsupportedCurrencyError } from 'domain-quotes';

try {
  await getDefaultQuote('invalid-tld', 'USD');
} catch (err) {
  if (err instanceof UnsupportedExtensionError) {
    console.log(err.code); // 'ERR_UNSUPPORTED_EXTENSION'
  }
}
```

## Notes

- **Rounding**: All monetary values are rounded to 2 decimal places at each step.
- **VAT**: A single VAT rate is applied to the subtotal (base price - discount). Default is 7.5%.
- **Extension normalization**: Leading dots are stripped and extensions are lowercased. `.COM`, `..com`, and `com` are all equivalent.
- **Discount order**: The `isEligible` callback is only called after date range, extension, and transaction type checks pass.
- **Remote data**: Price and exchange-rate data are fetched at import time from:
  - Prices: `https://raw.githubusercontent.com/namewiz/registrar-pricelist/refs/heads/main/data/unified-create-prices.csv`
  - Exchange rates: `https://raw.githubusercontent.com/namewiz/registrar-pricelist/refs/heads/main/data/exchange-rates.json`

  These are cached in-memory for the life of the process.

## Testing

```bash
npm test
```

The test suite uses Node's built-in `node:test` runner and builds the library first.
