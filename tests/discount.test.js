import assert from 'node:assert/strict';
import test from 'node:test';

import { DomainQuotes, normalizeExtension } from '../dist/index.js';

// Helper to create a minimal config for testing discounts
function createTestConfig(discounts = {}, overrides = {}) {
  return {
    createPrices: { com: 10, net: 12, org: 15, info: 8 },
    exchangeRates: [
      {
        countryCode: 'NG',
        currencyName: 'Nigerian Naira',
        currencySymbol: '₦',
        currencyCode: 'NGN',
        exchangeRate: 1000,
        inverseRate: 0.001,
      },
    ],
    vatRate: 0.1, // 10% for easy calculation
    discounts,
    supportedCurrencies: ['USD', 'NGN'],
    ...overrides,
  };
}

// Fixed timestamps for testing
const JAN_2024 = Date.parse('2024-01-15T12:00:00Z');
const JUN_2024 = Date.parse('2024-06-15T12:00:00Z');
const DEC_2024 = Date.parse('2024-12-15T12:00:00Z');

test('discount: no discount codes provided returns discount = 0', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);
  const quote = await dq.getQuote('com', 'USD', { now: JUN_2024 });
  assert.equal(quote.discount, 0);
});

test('discount: empty discountCodes array returns discount = 0', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);
  const quote = await dq.getQuote('com', 'USD', { discountCodes: [], now: JUN_2024 });
  assert.equal(quote.discount, 0);
});

test('discount: non-existent discount code returns discount = 0', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);
  const quote = await dq.getQuote('com', 'USD', { discountCodes: ['INVALID'], now: JUN_2024 });
  assert.equal(quote.discount, 0);
});

test('discount: valid code but wrong extension returns discount = 0', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'], // only com
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);
  const quote = await dq.getQuote('net', 'USD', { discountCodes: ['SAVE10'], now: JUN_2024 });
  assert.equal(quote.discount, 0);
});

test('discount: valid code but before startAt returns discount = 0', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-06-01T00:00:00Z', // starts June
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);
  const quote = await dq.getQuote('com', 'USD', { discountCodes: ['SAVE10'], now: JAN_2024 });
  assert.equal(quote.discount, 0);
});

test('discount: valid code but after endAt returns discount = 0', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-06-01T00:00:00Z', // ends June 1
    },
  });
  const dq = new DomainQuotes(config);
  const quote = await dq.getQuote('com', 'USD', { discountCodes: ['SAVE10'], now: DEC_2024 });
  assert.equal(quote.discount, 0);
});

test('discount: valid code within date range applies discount correctly', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1, // 10% discount
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);
  const quote = await dq.getQuote('com', 'USD', { discountCodes: ['SAVE10'], now: JUN_2024 });
  // basePrice = 10, discount = 10 * 0.1 = 1
  assert.equal(quote.basePrice, 10);
  assert.equal(quote.discount, 1);
});

test('discount: codes are case insensitive', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);

  const lowercase = await dq.getQuote('com', 'USD', { discountCodes: ['save10'], now: JUN_2024 });
  const uppercase = await dq.getQuote('com', 'USD', { discountCodes: ['SAVE10'], now: JUN_2024 });
  const mixedcase = await dq.getQuote('com', 'USD', { discountCodes: ['SaVe10'], now: JUN_2024 });

  assert.equal(lowercase.discount, 1);
  assert.equal(uppercase.discount, 1);
  assert.equal(mixedcase.discount, 1);
});

test('discount: duplicate codes are deduplicated', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);
  // Same code multiple times should only apply once
  const quote = await dq.getQuote('com', 'USD', {
    discountCodes: ['SAVE10', 'save10', 'SAVE10'],
    now: JUN_2024,
  });
  assert.equal(quote.discount, 1); // not 3
});

test('discount: default policy applies highest discount only', async () => {
  const config = createTestConfig({
    SMALL: {
      rate: 0.05, // 5%
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
    MEDIUM: {
      rate: 0.15, // 15%
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
    LARGE: {
      rate: 0.25, // 25%
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);
  const quote = await dq.getQuote('com', 'USD', {
    discountCodes: ['SMALL', 'MEDIUM', 'LARGE'],
    now: JUN_2024,
    allowFractionalAmounts: true,
  });
  // basePrice = 10, highest discount = 25% = 2.5
  assert.equal(quote.discount, 2.5);
});

test('discount: stack policy sums all applicable discounts', async () => {
  const config = createTestConfig({
    SMALL: {
      rate: 0.05, // 5%
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
    MEDIUM: {
      rate: 0.15, // 15%
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);
  const quote = await dq.getQuote('com', 'USD', {
    discountCodes: ['SMALL', 'MEDIUM'],
    discountPolicy: 'stack',
    now: JUN_2024,
    allowFractionalAmounts: true,
  });
  // basePrice = 10, total discount = 5% + 15% = 0.5 + 1.5 = 2
  assert.equal(quote.discount, 2);
});

test('discount: stacked discounts are capped at basePrice', async () => {
  const config = createTestConfig({
    HUGE1: {
      rate: 0.6, // 60%
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
    HUGE2: {
      rate: 0.6, // 60%
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);
  const quote = await dq.getQuote('com', 'USD', {
    discountCodes: ['HUGE1', 'HUGE2'],
    discountPolicy: 'stack',
    now: JUN_2024,
  });
  // basePrice = 10, combined = 120% = 12, but capped at 10
  assert.equal(quote.discount, 10);
  assert.equal(quote.basePrice - quote.discount, 0);
});

test('discount: single discount capped at basePrice', async () => {
  const config = createTestConfig({
    CRAZY: {
      rate: 1.5, // 150%
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);
  const quote = await dq.getQuote('com', 'USD', {
    discountCodes: ['CRAZY'],
    now: JUN_2024,
  });
  // 150% of 10 = 15, capped at 10
  assert.equal(quote.discount, 10);
});

test('discount: now option accepts Date object', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);
  const dateObj = new Date('2024-06-15T12:00:00Z');
  const quote = await dq.getQuote('com', 'USD', { discountCodes: ['SAVE10'], now: dateObj });
  assert.equal(quote.discount, 1);
});

test('discount: now option accepts timestamp number', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);
  const timestamp = Date.parse('2024-06-15T12:00:00Z');
  const quote = await dq.getQuote('com', 'USD', { discountCodes: ['SAVE10'], now: timestamp });
  assert.equal(quote.discount, 1);
});

test('discount: boundary - exactly at startAt is valid', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-06-15T12:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);
  const exactStart = Date.parse('2024-06-15T12:00:00Z');
  const quote = await dq.getQuote('com', 'USD', { discountCodes: ['SAVE10'], now: exactStart });
  assert.equal(quote.discount, 1);
});

test('discount: boundary - exactly at endAt is valid', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-06-15T12:00:00Z',
    },
  });
  const dq = new DomainQuotes(config);
  const exactEnd = Date.parse('2024-06-15T12:00:00Z');
  const quote = await dq.getQuote('com', 'USD', { discountCodes: ['SAVE10'], now: exactEnd });
  assert.equal(quote.discount, 1);
});

test('discount: boundary - 1ms before startAt is invalid', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-06-15T12:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);
  const beforeStart = Date.parse('2024-06-15T12:00:00Z') - 1;
  const quote = await dq.getQuote('com', 'USD', { discountCodes: ['SAVE10'], now: beforeStart });
  assert.equal(quote.discount, 0);
});

test('discount: boundary - 1ms after endAt is invalid', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-06-15T12:00:00Z',
    },
  });
  const dq = new DomainQuotes(config);
  const afterEnd = Date.parse('2024-06-15T12:00:00Z') + 1;
  const quote = await dq.getQuote('com', 'USD', { discountCodes: ['SAVE10'], now: afterEnd });
  assert.equal(quote.discount, 0);
});

test('discount: invalid date strings in config are skipped', async () => {
  const config = createTestConfig({
    BADSTART: {
      rate: 0.1,
      extensions: ['com'],
      startAt: 'not-a-date',
      endAt: '2024-12-31T23:59:59Z',
    },
    BADEND: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: 'invalid',
    },
  });
  const dq = new DomainQuotes(config);
  const quote = await dq.getQuote('com', 'USD', {
    discountCodes: ['BADSTART', 'BADEND'],
    now: JUN_2024,
  });
  assert.equal(quote.discount, 0);
});

test('discount: tax is calculated on subtotal (basePrice - discount)', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1, // 10% discount
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);
  const quote = await dq.getQuote('com', 'USD', { discountCodes: ['SAVE10'], now: JUN_2024, allowFractionalAmounts: true });
  // basePrice = 10, discount = 1, subtotal = 9
  // tax = 9 * 0.1 = 0.9
  assert.equal(quote.basePrice, 10);
  assert.equal(quote.discount, 1);
  assert.equal(quote.tax, 0.9);
});

test('discount: totalPrice = subtotal + tax', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1, // 10% discount
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);
  const quote = await dq.getQuote('com', 'USD', { discountCodes: ['SAVE10'], now: JUN_2024, allowFractionalAmounts: true });
  // basePrice = 10, discount = 1, subtotal = 9, tax = 0.9, total = 9.9
  assert.equal(quote.totalPrice, 9.9);
});

test('discount: multiple extensions in config work correctly', async () => {
  const config = createTestConfig({
    MULTI: {
      rate: 0.2, // 20%
      extensions: ['com', 'net', 'org'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);

  const comQuote = await dq.getQuote('com', 'USD', { discountCodes: ['MULTI'], now: JUN_2024, allowFractionalAmounts: true });
  const netQuote = await dq.getQuote('net', 'USD', { discountCodes: ['MULTI'], now: JUN_2024, allowFractionalAmounts: true });
  const orgQuote = await dq.getQuote('org', 'USD', { discountCodes: ['MULTI'], now: JUN_2024, allowFractionalAmounts: true });
  const infoQuote = await dq.getQuote('info', 'USD', { discountCodes: ['MULTI'], now: JUN_2024, allowFractionalAmounts: true });

  // com: 10 * 0.2 = 2
  assert.equal(comQuote.discount, 2);
  // net: 12 * 0.2 = 2.4
  assert.equal(netQuote.discount, 2.4);
  // org: 15 * 0.2 = 3
  assert.equal(orgQuote.discount, 3);
  // info: not in extensions list
  assert.equal(infoQuote.discount, 0);
});

test('discount: mixed valid and invalid codes apply only valid ones', async () => {
  const config = createTestConfig({
    VALID: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
    EXPIRED: {
      rate: 0.2,
      extensions: ['com'],
      startAt: '2023-01-01T00:00:00Z',
      endAt: '2023-12-31T23:59:59Z',
    },
    WRONGEXT: {
      rate: 0.3,
      extensions: ['net'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);
  const quote = await dq.getQuote('com', 'USD', {
    discountCodes: ['VALID', 'EXPIRED', 'WRONGEXT', 'NONEXISTENT'],
    now: JUN_2024,
  });
  // Only VALID applies: 10 * 0.1 = 1
  assert.equal(quote.discount, 1);
});

test('discount: works correctly with currency conversion (NGN)', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1, // 10%
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);
  const quote = await dq.getQuote('com', 'NGN', { discountCodes: ['SAVE10'], now: JUN_2024 });
  // basePrice in NGN = 10 * 1000 = 10000
  // discount = 10000 * 0.1 = 1000
  assert.equal(quote.basePrice, 10000);
  assert.equal(quote.discount, 1000);
  // subtotal = 9000, tax = 900, total = 9900
  assert.equal(quote.tax, 900);
  assert.equal(quote.totalPrice, 9900);
});

test('discount: stack policy with some valid and some invalid codes', async () => {
  const config = createTestConfig({
    VALID1: {
      rate: 0.05,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
    VALID2: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
    EXPIRED: {
      rate: 0.5,
      extensions: ['com'],
      startAt: '2023-01-01T00:00:00Z',
      endAt: '2023-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);
  const quote = await dq.getQuote('com', 'USD', {
    discountCodes: ['VALID1', 'VALID2', 'EXPIRED'],
    discountPolicy: 'stack',
    now: JUN_2024,
    allowFractionalAmounts: true,
  });
  // Only VALID1 (0.5) and VALID2 (1) apply = 1.5
  assert.equal(quote.discount, 1.5);
});

test('discount: empty discounts config returns discount = 0', async () => {
  const config = createTestConfig({});
  const dq = new DomainQuotes(config);
  const quote = await dq.getQuote('com', 'USD', { discountCodes: ['ANY'], now: JUN_2024 });
  assert.equal(quote.discount, 0);
});

test('discount: quote includes correct domainTransaction type', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);

  const createQuote = await dq.getQuote('com', 'USD', { discountCodes: ['SAVE10'], now: JUN_2024 });
  const renewQuote = await dq.getQuote('com', 'USD', {
    discountCodes: ['SAVE10'],
    now: JUN_2024,
    transaction: 'renew',
  });

  assert.equal(createQuote.domainTransaction, 'create');
  assert.equal(renewQuote.domainTransaction, 'renew');
  // Discount still applies
  assert.equal(createQuote.discount, 1);
  assert.equal(renewQuote.discount, 1);
});

// Extension normalization tests
test('normalizeExtension: strips leading dots', () => {
  assert.equal(normalizeExtension('.com'), 'com');
  assert.equal(normalizeExtension('..com'), 'com');
  assert.equal(normalizeExtension('...ng'), 'ng');
});

test('normalizeExtension: lowercases extension', () => {
  assert.equal(normalizeExtension('COM'), 'com');
  assert.equal(normalizeExtension('.COM'), 'com');
  assert.equal(normalizeExtension('NG'), 'ng');
});

test('normalizeExtension: trims whitespace', () => {
  assert.equal(normalizeExtension('  com  '), 'com');
  assert.equal(normalizeExtension('  .com  '), 'com');
});

test('normalizeExtension: handles empty and falsy values', () => {
  assert.equal(normalizeExtension(''), '');
  assert.equal(normalizeExtension(null), null);
  assert.equal(normalizeExtension(undefined), undefined);
});

test('discount: extension with leading dot in getQuote request works', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);

  const quote = await dq.getQuote('.com', 'USD', { discountCodes: ['SAVE10'], now: JUN_2024 });
  assert.equal(quote.extension, 'com'); // normalized in response
  assert.equal(quote.discount, 1); // discount applied
});

test('discount: extension with leading dot in config works', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['.com', '..net'], // leading dots in config
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);

  const comQuote = await dq.getQuote('com', 'USD', { discountCodes: ['SAVE10'], now: JUN_2024, allowFractionalAmounts: true });
  const netQuote = await dq.getQuote('net', 'USD', { discountCodes: ['SAVE10'], now: JUN_2024, allowFractionalAmounts: true });

  assert.equal(comQuote.discount, 1); // 10% of 10
  assert.equal(netQuote.discount, 1.2); // 10% of 12
});

test('discount: mixed dot formats in config and request work', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['.com', 'net', '..org'], // mixed formats
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);

  // Request with dots
  const quote1 = await dq.getQuote('.com', 'USD', { discountCodes: ['SAVE10'], now: JUN_2024, allowFractionalAmounts: true });
  const quote2 = await dq.getQuote('..net', 'USD', { discountCodes: ['SAVE10'], now: JUN_2024, allowFractionalAmounts: true });
  // Request without dots
  const quote3 = await dq.getQuote('org', 'USD', { discountCodes: ['SAVE10'], now: JUN_2024, allowFractionalAmounts: true });

  assert.equal(quote1.discount, 1);
  assert.equal(quote2.discount, 1.2);
  assert.equal(quote3.discount, 1.5);
});

// Transaction type filtering tests
test('discount: without transactions field applies to all transaction types', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      // no transactions field
    },
  });
  const dq = new DomainQuotes(config);

  const createQuote = await dq.getQuote('com', 'USD', {
    discountCodes: ['SAVE10'],
    now: JUN_2024,
    transaction: 'create',
  });
  const renewQuote = await dq.getQuote('com', 'USD', {
    discountCodes: ['SAVE10'],
    now: JUN_2024,
    transaction: 'renew',
  });
  const restoreQuote = await dq.getQuote('com', 'USD', {
    discountCodes: ['SAVE10'],
    now: JUN_2024,
    transaction: 'restore',
  });
  const transferQuote = await dq.getQuote('com', 'USD', {
    discountCodes: ['SAVE10'],
    now: JUN_2024,
    transaction: 'transfer',
  });

  // All transaction types should get the discount
  assert.equal(createQuote.discount, 1);
  assert.equal(renewQuote.discount, 1);
  assert.equal(restoreQuote.discount, 1);
  assert.equal(transferQuote.discount, 1);
});

test('discount: with empty transactions array applies to all transaction types', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      transactions: [], // empty array
    },
  });
  const dq = new DomainQuotes(config);

  const createQuote = await dq.getQuote('com', 'USD', {
    discountCodes: ['SAVE10'],
    now: JUN_2024,
    transaction: 'create',
  });
  const renewQuote = await dq.getQuote('com', 'USD', {
    discountCodes: ['SAVE10'],
    now: JUN_2024,
    transaction: 'renew',
  });

  assert.equal(createQuote.discount, 1);
  assert.equal(renewQuote.discount, 1);
});

test('discount: with single transaction type only applies to that type', async () => {
  const config = createTestConfig({
    NEWONLY: {
      rate: 0.2,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      transactions: ['create'], // only for new registrations
    },
  });
  const dq = new DomainQuotes(config);

  const createQuote = await dq.getQuote('com', 'USD', {
    discountCodes: ['NEWONLY'],
    now: JUN_2024,
    transaction: 'create',
  });
  const renewQuote = await dq.getQuote('com', 'USD', {
    discountCodes: ['NEWONLY'],
    now: JUN_2024,
    transaction: 'renew',
  });
  const restoreQuote = await dq.getQuote('com', 'USD', {
    discountCodes: ['NEWONLY'],
    now: JUN_2024,
    transaction: 'restore',
  });
  const transferQuote = await dq.getQuote('com', 'USD', {
    discountCodes: ['NEWONLY'],
    now: JUN_2024,
    transaction: 'transfer',
  });

  // Only create should get the discount
  assert.equal(createQuote.discount, 2); // 20% of 10
  assert.equal(renewQuote.discount, 0);
  assert.equal(restoreQuote.discount, 0);
  assert.equal(transferQuote.discount, 0);
});

test('discount: with multiple transaction types applies to specified types only', async () => {
  const config = createTestConfig({
    RENEWTRANSFER: {
      rate: 0.15,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      transactions: ['renew', 'transfer'], // only for renew and transfer
    },
  });
  const dq = new DomainQuotes(config);

  const createQuote = await dq.getQuote('com', 'USD', {
    discountCodes: ['RENEWTRANSFER'],
    now: JUN_2024,
    transaction: 'create',
    allowFractionalAmounts: true,
  });
  const renewQuote = await dq.getQuote('com', 'USD', {
    discountCodes: ['RENEWTRANSFER'],
    now: JUN_2024,
    transaction: 'renew',
    allowFractionalAmounts: true,
  });
  const restoreQuote = await dq.getQuote('com', 'USD', {
    discountCodes: ['RENEWTRANSFER'],
    now: JUN_2024,
    transaction: 'restore',
    allowFractionalAmounts: true,
  });
  const transferQuote = await dq.getQuote('com', 'USD', {
    discountCodes: ['RENEWTRANSFER'],
    now: JUN_2024,
    transaction: 'transfer',
    allowFractionalAmounts: true,
  });

  assert.equal(createQuote.discount, 0);
  assert.equal(renewQuote.discount, 1.5); // 15% of 10
  assert.equal(restoreQuote.discount, 0);
  assert.equal(transferQuote.discount, 1.5); // 15% of 10
});

test('discount: multiple codes with different transaction restrictions', async () => {
  const config = createTestConfig({
    CREATEONLY: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      transactions: ['create'],
    },
    RENEWONLY: {
      rate: 0.2,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      transactions: ['renew'],
    },
    ALLTYPES: {
      rate: 0.05,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      // applies to all
    },
  });
  const dq = new DomainQuotes(config);

  // Create: CREATEONLY (10%) and ALLTYPES (5%) apply, max policy takes 10%
  const createQuote = await dq.getQuote('com', 'USD', {
    discountCodes: ['CREATEONLY', 'RENEWONLY', 'ALLTYPES'],
    now: JUN_2024,
    transaction: 'create',
    allowFractionalAmounts: true,
  });
  // Renew: RENEWONLY (20%) and ALLTYPES (5%) apply, max policy takes 20%
  const renewQuote = await dq.getQuote('com', 'USD', {
    discountCodes: ['CREATEONLY', 'RENEWONLY', 'ALLTYPES'],
    now: JUN_2024,
    transaction: 'renew',
    allowFractionalAmounts: true,
  });
  // Restore: only ALLTYPES (5%) applies
  const restoreQuote = await dq.getQuote('com', 'USD', {
    discountCodes: ['CREATEONLY', 'RENEWONLY', 'ALLTYPES'],
    now: JUN_2024,
    transaction: 'restore',
    allowFractionalAmounts: true,
  });

  assert.equal(createQuote.discount, 1); // max(10%, 5%) = 10% of 10
  assert.equal(renewQuote.discount, 2); // max(20%, 5%) = 20% of 10
  assert.equal(restoreQuote.discount, 0.5); // 5% of 10
});

test('discount: stack policy with transaction-restricted codes', async () => {
  const config = createTestConfig({
    CREATEONLY: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      transactions: ['create'],
    },
    ALLTYPES: {
      rate: 0.05,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
    },
  });
  const dq = new DomainQuotes(config);

  // Create with stack: both apply = 10% + 5% = 15%
  const createQuote = await dq.getQuote('com', 'USD', {
    discountCodes: ['CREATEONLY', 'ALLTYPES'],
    discountPolicy: 'stack',
    now: JUN_2024,
    transaction: 'create',
    allowFractionalAmounts: true,
  });
  // Renew with stack: only ALLTYPES applies = 5%
  const renewQuote = await dq.getQuote('com', 'USD', {
    discountCodes: ['CREATEONLY', 'ALLTYPES'],
    discountPolicy: 'stack',
    now: JUN_2024,
    transaction: 'renew',
    allowFractionalAmounts: true,
  });

  assert.equal(createQuote.discount, 1.5); // 10% + 5% of 10
  assert.equal(renewQuote.discount, 0.5); // 5% of 10
});

test('discount: default transaction is create when not specified', async () => {
  const config = createTestConfig({
    CREATEONLY: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      transactions: ['create'],
    },
  });
  const dq = new DomainQuotes(config);

  // No transaction specified, defaults to 'create'
  const quote = await dq.getQuote('com', 'USD', {
    discountCodes: ['CREATEONLY'],
    now: JUN_2024,
  });

  assert.equal(quote.discount, 1);
  assert.equal(quote.domainTransaction, 'create');
});

// Eligibility callback tests
test('discount: isEligible callback returning true applies discount', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      isEligible: () => true,
    },
  });
  const dq = new DomainQuotes(config);

  const quote = await dq.getQuote('com', 'USD', { discountCodes: ['SAVE10'], now: JUN_2024 });
  assert.equal(quote.discount, 1);
});

test('discount: isEligible callback returning false skips discount', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      isEligible: () => false,
    },
  });
  const dq = new DomainQuotes(config);

  const quote = await dq.getQuote('com', 'USD', { discountCodes: ['SAVE10'], now: JUN_2024 });
  assert.equal(quote.discount, 0);
});

test('discount: async isEligible callback returning true applies discount', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      isEligible: async () => {
        // Simulate async operation
        await new Promise((resolve) => setTimeout(resolve, 1));
        return true;
      },
    },
  });
  const dq = new DomainQuotes(config);

  const quote = await dq.getQuote('com', 'USD', { discountCodes: ['SAVE10'], now: JUN_2024 });
  assert.equal(quote.discount, 1);
});

test('discount: async isEligible callback returning false skips discount', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      isEligible: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return false;
      },
    },
  });
  const dq = new DomainQuotes(config);

  const quote = await dq.getQuote('com', 'USD', { discountCodes: ['SAVE10'], now: JUN_2024 });
  assert.equal(quote.discount, 0);
});

test('discount: isEligible callback receives correct context', async () => {
  let receivedContext = null;
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      isEligible: (ctx) => {
        receivedContext = ctx;
        return true;
      },
    },
  });
  const dq = new DomainQuotes(config);

  await dq.getQuote('com', 'USD', {
    discountCodes: ['SAVE10'],
    now: JUN_2024,
    transaction: 'renew',
  });

  assert.ok(receivedContext !== null);
  assert.equal(receivedContext.extension, 'com');
  assert.equal(receivedContext.currency, 'USD');
  assert.equal(receivedContext.transaction, 'renew');
  assert.equal(receivedContext.basePrice, 10);
  assert.equal(receivedContext.discountCode, 'SAVE10');
});

test('discount: isEligible callback is only called when other criteria pass', async () => {
  let callCount = 0;
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'], // only com
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      isEligible: () => {
        callCount++;
        return true;
      },
    },
  });
  const dq = new DomainQuotes(config);

  // Extension doesn't match - callback should NOT be called
  await dq.getQuote('net', 'USD', { discountCodes: ['SAVE10'], now: JUN_2024 });
  assert.equal(callCount, 0, 'Callback should not be called when extension does not match');

  // Extension matches - callback SHOULD be called
  await dq.getQuote('com', 'USD', { discountCodes: ['SAVE10'], now: JUN_2024 });
  assert.equal(callCount, 1, 'Callback should be called when all criteria pass');
});

test('discount: isEligible not called when date range invalid', async () => {
  let callCount = 0;
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-06-01T00:00:00Z', // starts June
      endAt: '2024-12-31T23:59:59Z',
      isEligible: () => {
        callCount++;
        return true;
      },
    },
  });
  const dq = new DomainQuotes(config);

  // Before start date - callback should NOT be called
  await dq.getQuote('com', 'USD', { discountCodes: ['SAVE10'], now: JAN_2024 });
  assert.equal(callCount, 0);
});

test('discount: isEligible not called when transaction type invalid', async () => {
  let callCount = 0;
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      transactions: ['create'], // only create
      isEligible: () => {
        callCount++;
        return true;
      },
    },
  });
  const dq = new DomainQuotes(config);

  // Wrong transaction type - callback should NOT be called
  await dq.getQuote('com', 'USD', { discountCodes: ['SAVE10'], now: JUN_2024, transaction: 'renew' });
  assert.equal(callCount, 0);
});

test('discount: isEligible callback throwing error skips discount', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      isEligible: () => {
        throw new Error('Simulated error');
      },
    },
  });
  const dq = new DomainQuotes(config);

  // Should not throw, just skip the discount
  const quote = await dq.getQuote('com', 'USD', { discountCodes: ['SAVE10'], now: JUN_2024 });
  assert.equal(quote.discount, 0);
});

test('discount: async isEligible callback rejecting skips discount', async () => {
  const config = createTestConfig({
    SAVE10: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      isEligible: async () => {
        throw new Error('Async error');
      },
    },
  });
  const dq = new DomainQuotes(config);

  const quote = await dq.getQuote('com', 'USD', { discountCodes: ['SAVE10'], now: JUN_2024 });
  assert.equal(quote.discount, 0);
});

test('discount: multiple codes with mixed callbacks', async () => {
  const config = createTestConfig({
    ELIGIBLE: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      isEligible: () => true,
    },
    NOTELIGIBLE: {
      rate: 0.2,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      isEligible: () => false,
    },
    NOCALLBACK: {
      rate: 0.15,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      // no isEligible - always eligible
    },
  });
  const dq = new DomainQuotes(config);

  // Default (max) policy: ELIGIBLE (10%) and NOCALLBACK (15%) apply, max = 15%
  const quote = await dq.getQuote('com', 'USD', {
    discountCodes: ['ELIGIBLE', 'NOTELIGIBLE', 'NOCALLBACK'],
    now: JUN_2024,
    allowFractionalAmounts: true,
  });
  assert.equal(quote.discount, 1.5); // 15% of 10
});

test('discount: stack policy with callbacks', async () => {
  const config = createTestConfig({
    ELIGIBLE1: {
      rate: 0.1,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      isEligible: () => true,
    },
    ELIGIBLE2: {
      rate: 0.05,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      isEligible: () => true,
    },
    NOTELIGIBLE: {
      rate: 0.5,
      extensions: ['com'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      isEligible: () => false,
    },
  });
  const dq = new DomainQuotes(config);

  const quote = await dq.getQuote('com', 'USD', {
    discountCodes: ['ELIGIBLE1', 'ELIGIBLE2', 'NOTELIGIBLE'],
    discountPolicy: 'stack',
    now: JUN_2024,
    allowFractionalAmounts: true,
  });
  // Only ELIGIBLE1 (10%) and ELIGIBLE2 (5%) apply = 15%
  assert.equal(quote.discount, 1.5);
});

test('discount: callback can use context for conditional logic', async () => {
  const config = createTestConfig({
    BIGSPENDER: {
      rate: 0.2,
      extensions: ['com', 'net', 'org'],
      startAt: '2024-01-01T00:00:00Z',
      endAt: '2024-12-31T23:59:59Z',
      // Only apply if base price >= 12
      isEligible: (ctx) => ctx.basePrice >= 12,
    },
  });
  const dq = new DomainQuotes(config);

  // com costs 10, should NOT be eligible
  const comQuote = await dq.getQuote('com', 'USD', { discountCodes: ['BIGSPENDER'], now: JUN_2024, allowFractionalAmounts: true });
  assert.equal(comQuote.discount, 0);

  // net costs 12, should be eligible
  const netQuote = await dq.getQuote('net', 'USD', { discountCodes: ['BIGSPENDER'], now: JUN_2024, allowFractionalAmounts: true });
  assert.equal(netQuote.discount, 2.4); // 20% of 12

  // org costs 15, should be eligible
  const orgQuote = await dq.getQuote('org', 'USD', { discountCodes: ['BIGSPENDER'], now: JUN_2024, allowFractionalAmounts: true });
  assert.equal(orgQuote.discount, 3); // 20% of 15
});
