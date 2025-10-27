import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_CONFIG as DEFAULT_RATES,
  DomainPrices,
  getDefaultPrice,
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

test('getDefaultPrice computes USD price and no tax for US', async () => {
  const quote = await getDefaultPrice('com', 'USD');
  assert.equal(quote.extension, 'com');
  assert.equal(quote.currency, 'USD');
  assert.equal(typeof quote.basePrice, 'number');
  assert.equal(typeof quote.totalPrice, 'number');
  // In the US dataset, tax is 0
  assert.equal(quote.tax, 0);
  assert.equal(quote.totalPrice, Number((quote.basePrice - quote.discount + quote.tax).toFixed(2)));
});

test('getDefaultPrice applies tax by currency for NGN by default', async () => {
  // NGN -> NG -> 7.5%
  const ng = await getDefaultPrice('com', 'NGN');
  const expectedNgTax = Number(((ng.basePrice - ng.discount) * 0.075).toFixed(2));
  assert.equal(ng.tax, expectedNgTax);
});

test('DomainPrices respects custom supportedCurrencies for GBP/EUR', async () => {
  const dp = new DomainPrices({
    ...DEFAULT_RATES,
    supportedCurrencies: ['USD', 'NGN', 'GBP', 'EUR'],
  });

  // GBP -> GB -> 20%
  const gb = await dp.getPrice('com', 'GBP');
  const expectedGbTax = Number(((gb.basePrice - gb.discount) * 0.2).toFixed(2));
  assert.equal(gb.tax, expectedGbTax);

  // EUR -> DE -> 19%
  const eu = await dp.getPrice('com', 'EUR');
  const expectedEuTax = Number(((eu.basePrice - eu.discount) * 0.19).toFixed(2));
  assert.equal(eu.tax, expectedEuTax);
});

test('getDefaultPrice applies highest discount only by default', async () => {
  // Given the current dataset, only SAVE1 is active into 2025
  const noDisc = await getDefaultPrice('com', 'USD');
  const withDisc = await getDefaultPrice('com', 'USD', { discountCodes: ['save1', 'NEWUSER15', 'invalid'] });
  assert.equal(withDisc.discount, Number((noDisc.basePrice * 0.01).toFixed(2)));
  assert.equal(withDisc.totalPrice, Number((withDisc.basePrice - withDisc.discount + withDisc.tax).toFixed(2)));
});

test('discount does not apply when extension not eligible', async () => {
  // SAVE1 is for com/net only
  const xyz = await getDefaultPrice('xyz', 'USD', { discountCodes: ['SAVE1'] });
  assert.equal(xyz.discount, 0);
});

test('percentage markup increases base price before discounting', async () => {
  const baseline = await getDefaultPrice('com', 'USD', { discountCodes: ['SAVE1'] });
  const dp = new DomainPrices({
    ...DEFAULT_RATES,
    markup: { type: 'percentage', value: 0.25 },
  });
  const quote = await dp.getPrice('com', 'USD', { discountCodes: ['SAVE1'] });
  const expected = Number((baseline.basePrice * 1.25).toFixed(2));
  assert.equal(quote.basePrice, expected);
  assert.equal(quote.discount, Number((expected * 0.01).toFixed(2))); // SAVE1 applies
});

test('fixed USD markup adjusts prices before currency conversion', async () => {
  const ext = 'com';
  const markupUsd = 5;

  // Baseline without markup
  const baselineUsd = await getDefaultPrice(ext, 'USD');
  const baselineNgn = await getDefaultPrice(ext, 'NGN');

  // With fixed USD markup (added before conversion)
  const dp = new DomainPrices({
    ...DEFAULT_RATES,
    markup: { type: 'fixedUsd', value: markupUsd },
  });
  const quotedUsd = await dp.getPrice(ext, 'USD');
  const quotedNgn = await dp.getPrice(ext, 'NGN');

  // USD base increases exactly by the USD markup value
  assert.equal(
    quotedUsd.basePrice,
    Number((baselineUsd.basePrice + markupUsd).toFixed(2))
  );

  // NGN base increase ~= USD markup scaled by NGN rate (rounding tolerance)
  const ngnRate = DEFAULT_RATES.exchangeRates.find((r) => r.currencyCode === 'NGN')?.exchangeRate;
  assert.ok(typeof ngnRate === 'number');
  const expectedNgnIncrease = Number((markupUsd * ngnRate).toFixed(2));
  const actualNgnIncrease = Number((quotedNgn.basePrice - baselineNgn.basePrice).toFixed(2));
  // Allow ±0.01 because each base is rounded separately
  assert.ok(Math.abs(actualNgnIncrease - expectedNgnIncrease) <= 0.01);
});

// priceForDomain API removed; getDefaultPrice accepts an extension.

test('errors on unsupported extension', async () => {
  await assert.rejects(
    () => getDefaultPrice('unknown-tld', 'USD'),
    (err) => err instanceof UnsupportedExtensionError && err.code === 'ERR_UNSUPPORTED_EXTENSION'
  );
});

test('errors on unsupported currency', async () => {
  await assert.rejects(
    () => getDefaultPrice('com', 'JPY'),
    (err) => err instanceof UnsupportedCurrencyError && err.code === 'ERR_UNSUPPORTED_CURRENCY'
  );
});

test('transaction option defaults to create and falls back to default prices', async () => {
  const createQuote = await getDefaultPrice('com', 'USD');
  const renewQuote = await getDefaultPrice('com', 'USD', { transaction: 'renew' });
  const transferQuote = await getDefaultPrice('com', 'USD', { transaction: 'transfer' });
  const restoreQuote = await getDefaultPrice('com', 'USD', { transaction: 'restore' });

  assert.equal(renewQuote.basePrice, createQuote.basePrice);
  assert.equal(transferQuote.basePrice, createQuote.basePrice);
  assert.equal(restoreQuote.basePrice, createQuote.basePrice);

  assert.equal(createQuote.transaction, 'create');
  assert.equal(renewQuote.transaction, 'renew');
  assert.equal(transferQuote.transaction, 'transfer');
  assert.equal(restoreQuote.transaction, 'restore');
});

test('renewPrices override is used when provided in config', async () => {
  const baseline = await getDefaultPrice('com', 'USD');
  const customRenewUsd = Number((baseline.basePrice + 2).toFixed(2));
  const dp = new DomainPrices({
    ...DEFAULT_RATES,
    renewPrices: { com: customRenewUsd },
  });
  const renew = await dp.getPrice('com', 'USD', { transaction: 'renew' });
  assert.equal(renew.basePrice, customRenewUsd);
});
