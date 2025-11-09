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
  const quote = await getDefaultQuote('com', 'USD');
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
  const ng = await getDefaultQuote('com', 'NGN');
  const expectedNgTax = Number(((ng.basePrice - ng.discount) * 0.075).toFixed(2));
  assert.equal(ng.tax, expectedNgTax);
});

test('DomainQuotes supports GBP/EUR and applies single VAT rate', async () => {
  const dp = new DomainQuotes({
    ...DEFAULT_CONFIG,
    supportedCurrencies: ['USD', 'NGN', 'GBP', 'EUR'],
  });

  // Default VAT of 7.5% applies to GBP
  const gb = await dp.getQuote('com', 'GBP');
  const expectedGbTax = Number(((gb.basePrice - gb.discount) * 0.075).toFixed(2));
  assert.equal(gb.tax, expectedGbTax, 'GBP tax should be 7.5%');

  // Default VAT of 7.5% applies to EUR
  const eu = await dp.getQuote('com', 'EUR');
  const expectedEuTax = Number(((eu.basePrice - eu.discount) * 0.075).toFixed(2));
  assert.equal(eu.tax, expectedEuTax, 'EUR tax should be 7.5%');
});

test('getDefaultQuote applies highest discount only by default', async () => {
  // Given the current dataset, only SAVE1 is active into 2025
  const noDisc = await getDefaultQuote('com', 'USD');
  const withDisc = await getDefaultQuote('com', 'USD', { discountCodes: ['save1', 'NEWUSER15', 'invalid'] });
  assert.equal(withDisc.discount, Number((noDisc.basePrice * 0.01).toFixed(2)));
  assert.equal(withDisc.totalPrice, Number((withDisc.basePrice - withDisc.discount + withDisc.tax).toFixed(2)));
});

test('discount does not apply when extension not eligible', async () => {
  // SAVE1 is for com/net only
  const xyz = await getDefaultQuote('xyz', 'USD', { discountCodes: ['SAVE1'] });
  assert.equal(xyz.discount, 0);
});

test('percentage markup increases base price before discounting', async () => {
  const baseline = await getDefaultQuote('com', 'USD', { discountCodes: ['SAVE1'] });
  const dp = new DomainQuotes({
    ...DEFAULT_CONFIG,
    markup: { type: 'percentage', value: 0.25 },
  });
  const quote = await dp.getQuote('com', 'USD', { discountCodes: ['SAVE1'] });
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

test('transaction option defaults to create and falls back to default pricing', async () => {
  const createQuote = await getDefaultQuote('com', 'USD');
  const renewQuote = await getDefaultQuote('com', 'USD', { transaction: 'renew' });
  const transferQuote = await getDefaultQuote('com', 'USD', { transaction: 'transfer' });
  const restoreQuote = await getDefaultQuote('com', 'USD', { transaction: 'restore' });

  assert.equal(renewQuote.basePrice, createQuote.basePrice);
  assert.equal(transferQuote.basePrice, createQuote.basePrice);
  assert.equal(restoreQuote.basePrice, createQuote.basePrice);

  assert.equal(createQuote.transaction, 'create');
  assert.equal(renewQuote.transaction, 'renew');
  assert.equal(transferQuote.transaction, 'transfer');
  assert.equal(restoreQuote.transaction, 'restore');
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
