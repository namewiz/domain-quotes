import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_CONFIG,
  DomainQuotes,
  getDefaultQuote,
  isSupportedCurrency,
  isSupportedExtension,
  listSupportedCurrencies,
  listSupportedExtensions,
  UnsupportedCurrencyError,
  UnsupportedExtensionError,
} from '../dist/index.js';

test('supported currency list defaults to [USD, NGN]', () => {
  const list = listSupportedCurrencies();
  assert.ok(Array.isArray(list));
  assert.ok(list.includes('USD'));
  assert.ok(list.includes('NGN'));
  // GBP/EUR are not enabled by default
  assert.equal(list.includes('GBP'), false);
  assert.equal(list.includes('EUR'), false);
});

test('supported extensions includes com and basic resolution works', () => {
  const list = listSupportedExtensions();
  assert.ok(list.includes('com'));
  assert.equal(isSupportedExtension('com'), true);
  assert.equal(isSupportedExtension('example.com'), false);
  assert.equal(isSupportedExtension('unknown-tld'), false);
});

test('normalization only lowercases and strips leading dots', () => {
  // Leading dots are removed; case is ignored
  assert.equal(isSupportedExtension('.com'), true);
  assert.equal(isSupportedExtension('..COM'), true);
  assert.equal(isSupportedExtension('Com'), true);

  // Domains are not parsed; no longest-suffix matching
  assert.equal(isSupportedExtension('example.com'), false);
  assert.equal(isSupportedExtension('.example.com'), false);
});

test('isSupportedCurrency basic checks', () => {
  assert.equal(isSupportedCurrency('USD'), true);
  assert.equal(isSupportedCurrency('usd'), true);
  assert.equal(isSupportedCurrency('NGN'), true);
  assert.equal(isSupportedCurrency('GBP'), false);
  assert.equal(isSupportedCurrency('EUR'), false);
  assert.equal(isSupportedCurrency('JPY'), false);
});

test('getDefaultQuote computes USD price with default 7.5% VAT', async () => {
  const quote = await getDefaultQuote('com', 'USD', { allowFractionalAmounts: true });
  assert.equal(quote.extension, 'com');
  assert.equal(quote.currency, 'USD');
  assert.equal(typeof quote.basePrice, 'number');
  assert.equal(typeof quote.totalPrice, 'number');
  // Default VAT applied is 7.5%
  const expectedTax = Number(((quote.basePrice - quote.discount) * 0.075).toFixed(2));
  assert.equal(quote.tax, expectedTax);
  assert.equal(quote.totalPrice, Number((quote.basePrice - quote.discount + quote.tax).toFixed(2)));
});

test('getDefaultQuote applies tax by currency for NGN by default', async () => {
  // NGN -> NG -> 7.5%
  const ng = await getDefaultQuote('com', 'NGN', { allowFractionalAmounts: true });
  const expectedNgTax = Number(((ng.basePrice - ng.discount) * 0.075).toFixed(2));
  assert.equal(ng.tax, expectedNgTax);
});

test('DomainQuotes supports GBP/EUR and applies single VAT rate', async () => {
  const dp = new DomainQuotes({
    ...DEFAULT_CONFIG,
    supportedCurrencies: ['USD', 'NGN', 'GBP', 'EUR'],
  });

  // Default VAT of 7.5% applies to GBP
  const gb = await dp.getQuote('com', 'GBP', { allowFractionalAmounts: true });
  const expectedGbTax = Number(((gb.basePrice - gb.discount) * 0.075).toFixed(2));
  assert.equal(gb.tax, expectedGbTax, 'GBP tax should be 7.5%');

  // Default VAT of 7.5% applies to EUR
  const eu = await dp.getQuote('com', 'EUR', { allowFractionalAmounts: true });
  const expectedEuTax = Number(((eu.basePrice - eu.discount) * 0.075).toFixed(2));
  assert.equal(eu.tax, expectedEuTax, 'EUR tax should be 7.5%');
});

test('getDefaultQuote applies highest discount only by default', async () => {
  // Create a custom config with discounts for testing
  const dp = new DomainQuotes({
    ...DEFAULT_CONFIG,
    discounts: {
      SAVE1: {
        rate: 0.01,
        extensions: ['com', 'net'],
        startAt: '2023-01-01T00:00:00Z',
        endAt: '2030-12-31T23:59:59Z',
      },
      NEWUSER15: {
        rate: 0.15,
        extensions: ['com', 'net', 'org'],
        startAt: '2023-01-01T00:00:00Z',
        endAt: '2030-12-31T23:59:59Z',
      },
    },
  });
  const noDisc = await dp.getQuote('com', 'USD', { allowFractionalAmounts: true });
  const withDisc = await dp.getQuote('com', 'USD', { discountCodes: ['save1', 'NEWUSER15', 'invalid'], allowFractionalAmounts: true });
  // Highest discount is NEWUSER15 at 15%
  assert.equal(withDisc.discount, Number((noDisc.basePrice * 0.15).toFixed(2)));
  assert.equal(withDisc.totalPrice, Number((withDisc.basePrice - withDisc.discount + withDisc.tax).toFixed(2)));
});

test('discount does not apply when extension not eligible', async () => {
  // SAVE1 is for com/net only
  const dp = new DomainQuotes({
    ...DEFAULT_CONFIG,
    discounts: {
      SAVE1: {
        rate: 0.01,
        extensions: ['com', 'net'],
        startAt: '2023-01-01T00:00:00Z',
        endAt: '2030-12-31T23:59:59Z',
      },
    },
  });
  const xyz = await dp.getQuote('xyz', 'USD', { discountCodes: ['SAVE1'] });
  assert.equal(xyz.discount, 0);
});

test('percentage markup increases base price before discounting', async () => {
  const discounts = {
    SAVE1: {
      rate: 0.01,
      extensions: ['com', 'net'],
      startAt: '2023-01-01T00:00:00Z',
      endAt: '2030-12-31T23:59:59Z',
    },
  };
  const baselineDp = new DomainQuotes({
    ...DEFAULT_CONFIG,
    discounts,
  });
  const baseline = await baselineDp.getQuote('com', 'USD', { discountCodes: ['SAVE1'], allowFractionalAmounts: true });
  const dp = new DomainQuotes({
    ...DEFAULT_CONFIG,
    markup: { type: 'percentage', value: 0.25 },
    discounts,
  });
  const quote = await dp.getQuote('com', 'USD', { discountCodes: ['SAVE1'], allowFractionalAmounts: true });
  const expected = Number((baseline.basePrice * 1.25).toFixed(2));
  assert.equal(quote.basePrice, expected);
  assert.equal(quote.discount, Number((expected * 0.01).toFixed(2))); // SAVE1 applies
});

test('fixed USD markup adjusts prices before currency conversion', async () => {
  const ext = 'com';
  const markupUsd = 5;

  // Baseline without markup
  const baselineUsd = await getDefaultQuote(ext, 'USD');
  const baselineNgn = await getDefaultQuote(ext, 'NGN');

  // With fixed USD markup (added before conversion)
  const dp = new DomainQuotes({
    ...DEFAULT_CONFIG,
    markup: { type: 'fixedUsd', value: markupUsd },
  });
  const quotedUsd = await dp.getQuote(ext, 'USD');
  const quotedNgn = await dp.getQuote(ext, 'NGN');

  // USD base increases exactly by the USD markup value
  assert.equal(
    quotedUsd.basePrice,
    Number((baselineUsd.basePrice + markupUsd).toFixed(2))
  );

  // NGN base increase ~= USD markup scaled by NGN rate (rounding tolerance)
  const ngnRate = DEFAULT_CONFIG.exchangeRates.find((r) => r.currencyCode === 'NGN')?.exchangeRate;
  assert.ok(typeof ngnRate === 'number');
  const expectedNgnIncrease = Number((markupUsd * ngnRate).toFixed(2));
  const actualNgnIncrease = Number((quotedNgn.basePrice - baselineNgn.basePrice).toFixed(2));
  // Allow ±0.1 because each base is rounded separately
  assert.ok(Math.abs(actualNgnIncrease - expectedNgnIncrease) <= 0.1);
});

test('uses direct currency pricing when available', async () => {
  const rate = 150;
  const config = {
    createPrices: {
      com: { USD: 10, NGN: 1500 },
    },
    exchangeRates: [
      {
        countryCode: 'NG',
        currencyName: 'Nigerian Naira',
        currencySymbol: '₦',
        currencyCode: 'NGN',
        exchangeRate: rate,
        inverseRate: 1 / rate,
      },
    ],
    vatRate: 0,
    discounts: {},
    supportedCurrencies: ['USD', 'NGN'],
  };
  const dq = new DomainQuotes(config);
  const ngQuote = await dq.getQuote('com', 'NGN');
  assert.equal(ngQuote.basePrice, 1500);
  const usdQuote = await dq.getQuote('com', 'USD');
  assert.equal(usdQuote.basePrice, 10);
});

test('falls back to exchange rate when currency price missing', async () => {
  const rate = 150;
  const config = {
    createPrices: {
      com: { USD: 12 },
    },
    exchangeRates: [
      {
        countryCode: 'NG',
        currencyName: 'Nigerian Naira',
        currencySymbol: '₦',
        currencyCode: 'NGN',
        exchangeRate: rate,
        inverseRate: 1 / rate,
      },
    ],
    vatRate: 0,
    discounts: {},
    supportedCurrencies: ['USD', 'NGN'],
  };
  const dq = new DomainQuotes(config);
  const ngQuote = await dq.getQuote('com', 'NGN');
  assert.equal(ngQuote.basePrice, Number((12 * rate).toFixed(2)));
});

test('errors on unsupported extension', async () => {
  await assert.rejects(
    () => getDefaultQuote('unknown-tld', 'USD'),
    (err) => err instanceof UnsupportedExtensionError && err.code === 'ERR_UNSUPPORTED_EXTENSION'
  );
});

test('errors on unsupported currency', async () => {
  await assert.rejects(
    () => getDefaultQuote('com', 'JPY'),
    (err) => err instanceof UnsupportedCurrencyError && err.code === 'ERR_UNSUPPORTED_CURRENCY'
  );
});

test('transaction option defaults to create and sets correct domainTransaction', async () => {
  const createQuote = await getDefaultQuote('com', 'USD');
  const renewQuote = await getDefaultQuote('com', 'USD', { transaction: 'renew' });
  const transferQuote = await getDefaultQuote('com', 'USD', { transaction: 'transfer' });
  const restoreQuote = await getDefaultQuote('com', 'USD', { transaction: 'restore' });

  // All should return valid prices
  assert.ok(createQuote.basePrice > 0);
  assert.ok(renewQuote.basePrice > 0);
  assert.ok(transferQuote.basePrice > 0);
  assert.ok(restoreQuote.basePrice > 0);

  // Verify transaction types are set correctly
  assert.equal(createQuote.domainTransaction, 'create');
  assert.equal(renewQuote.domainTransaction, 'renew');
  assert.equal(transferQuote.domainTransaction, 'transfer');
  assert.equal(restoreQuote.domainTransaction, 'restore');
});

test('renewPrices override is used when provided in config', async () => {
  const baseline = await getDefaultQuote('com', 'USD');
  const customRenewUsd = Number((baseline.basePrice + 2).toFixed(2));
  const dp = new DomainQuotes({
    ...DEFAULT_CONFIG,
    renewPrices: { com: customRenewUsd },
  });
  const renew = await dp.getQuote('com', 'USD', { transaction: 'renew' });
  assert.equal(renew.basePrice, customRenewUsd);
});

test('allowFractionalAmounts=false rounds amounts to nearest integer', async () => {
  const dp = new DomainQuotes({
    createPrices: { com: 10.5 },
    exchangeRates: [],
    vatRate: 0.075, // 7.5% VAT
    discounts: {
      SAVE15: {
        rate: 0.15,
        extensions: ['com'],
        startAt: '2023-01-01T00:00:00Z',
        endAt: '2030-12-31T23:59:59Z',
      },
    },
    supportedCurrencies: ['USD'],
  });

  // With allowFractionalAmounts: false (default), amounts should be rounded
  const quote = await dp.getQuote('com', 'USD', {
    discountCodes: ['SAVE15'],
    allowFractionalAmounts: false,
  });

  // basePrice: 10.5 -> rounds to 11
  assert.equal(quote.basePrice, 11);
  // discount: 11 * 0.15 = 1.65 -> rounds to 2
  assert.equal(quote.discount, 2);
  // subtotal: 11 - 2 = 9
  // tax: 9 * 0.075 = 0.675 -> rounds to 1
  assert.equal(quote.tax, 1);
  // totalPrice: 9 + 1 = 10
  assert.equal(quote.totalPrice, 10);

  // Verify all amounts are integers
  assert.equal(Number.isInteger(quote.basePrice), true);
  assert.equal(Number.isInteger(quote.discount), true);
  assert.equal(Number.isInteger(quote.tax), true);
  assert.equal(Number.isInteger(quote.totalPrice), true);
});

test('allowFractionalAmounts defaults to false', async () => {
  const dp = new DomainQuotes({
    createPrices: { com: 10 },
    exchangeRates: [],
    vatRate: 0.1, // 10% VAT
    discounts: {
      SAVE5: {
        rate: 0.05,
        extensions: ['com'],
        startAt: '2023-01-01T00:00:00Z',
        endAt: '2030-12-31T23:59:59Z',
      },
    },
    supportedCurrencies: ['USD'],
  });

  // Without specifying allowFractionalAmounts, it should default to false
  const quote = await dp.getQuote('com', 'USD', { discountCodes: ['SAVE5'] });

  // discount: 10 * 0.05 = 0.5 -> rounds to 1 (not 0.5)
  assert.equal(quote.discount, 1);
  // subtotal: 10 - 1 = 9
  // tax: 9 * 0.1 = 0.9 -> rounds to 1
  assert.equal(quote.tax, 1);
  // totalPrice: 9 + 1 = 10
  assert.equal(quote.totalPrice, 10);
});
