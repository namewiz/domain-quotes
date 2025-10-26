import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULTS_Sept2025,
  DomainPrices,
  getDefaultPrice,
  isSupportedCurrency,
  isSupportedExtension,
  listSupportedCurrencies,
  listSupportedExtensions,
  UnsupportedCurrencyError,
  UnsupportedExtensionError,
} from '../dist/index.js';

test('supported currency list contains core set', () => {
  const list = listSupportedCurrencies();
  assert.ok(Array.isArray(list));
  ['USD', 'GBP', 'EUR', 'NGN'].forEach((c) => assert.ok(list.includes(c)));
});

test('supported extensions includes com and basic resolution works', () => {
  const list = listSupportedExtensions();
  assert.ok(list.includes('com'));
  assert.equal(isSupportedExtension('com'), true);
  assert.equal(isSupportedExtension('example.com'), true);
  assert.equal(isSupportedExtension('unknown-tld'), false);
});

test('isSupportedCurrency basic checks', () => {
  assert.equal(isSupportedCurrency('USD'), true);
  assert.equal(isSupportedCurrency('usd'), true);
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

test('getDefaultPrice applies tax by currency (GBP/EUR/NGN)', async () => {
  // GBP -> GB -> 20%
  const gb = await getDefaultPrice('com', 'GBP');
  const expectedGbTax = Number(((gb.basePrice - gb.discount) * 0.2).toFixed(2));
  assert.equal(gb.tax, expectedGbTax);

  // EUR -> DE -> 19%
  const eu = await getDefaultPrice('com', 'EUR');
  const expectedEuTax = Number(((eu.basePrice - eu.discount) * 0.19).toFixed(2));
  assert.equal(eu.tax, expectedEuTax);

  // NGN -> NG -> 7.5%
  const ng = await getDefaultPrice('com', 'NGN');
  const expectedNgTax = Number(((ng.basePrice - ng.discount) * 0.075).toFixed(2));
  assert.equal(ng.tax, expectedNgTax);
});

test('getDefaultPrice applies highest discount only by default', async () => {
  // Given the current dataset, only SAVE10 is active into 2025
  const noDisc = await getDefaultPrice('com', 'USD');
  const withDisc = await getDefaultPrice('com', 'USD', { discountCodes: ['save10', 'NEWUSER15', 'invalid'] });
  assert.equal(withDisc.discount, Number((noDisc.basePrice * 0.1).toFixed(2)));
  assert.equal(withDisc.totalPrice, Number((withDisc.basePrice - withDisc.discount + withDisc.tax).toFixed(2)));
});

test('discount does not apply when extension not eligible', async () => {
  // SAVE10 is for com/net only
  const xyz = await getDefaultPrice('xyz', 'USD', { discountCodes: ['SAVE10'] });
  assert.equal(xyz.discount, 0);
});

test('percentage markup increases base price before discounting', async () => {
  const baseline = await getDefaultPrice('com', 'USD', { discountCodes: ['SAVE10'] });
  const dp = new DomainPrices({
    ...DEFAULTS_Sept2025,
    markup: { type: 'percentage', value: 0.25 },
  });
  const quote = await dp.getPrice('com', 'USD', { discountCodes: ['SAVE10'] });
  const expected = Number((baseline.basePrice * 1.25).toFixed(2));
  assert.equal(quote.basePrice, expected);
  assert.equal(quote.discount, Number((expected * 0.1).toFixed(2))); // SAVE10 applies
});

test('fixed USD markup adjusts prices before currency conversion', async () => {
  const ext = 'com';
  const markupUsd = 5;

  // Baseline without markup
  const baselineUsd = await getDefaultPrice(ext, 'USD');
  const baselineEur = await getDefaultPrice(ext, 'EUR');

  // With fixed USD markup (added before conversion)
  const dp = new DomainPrices({
    ...DEFAULTS_Sept2025,
    markup: { type: 'fixedUsd', value: markupUsd },
  });
  const quotedUsd = await dp.getPrice(ext, 'USD');
  const quotedEur = await dp.getPrice(ext, 'EUR');

  // USD base increases exactly by the USD markup value
  assert.equal(
    quotedUsd.basePrice,
    Number((baselineUsd.basePrice + markupUsd).toFixed(2))
  );

  // EUR base increase ~= USD markup scaled by EUR rate (rounding tolerance)
  const eurRate = DEFAULTS_Sept2025.exchangeRates.find((r) => r.currencyCode === 'EUR')?.exchangeRate;
  assert.ok(typeof eurRate === 'number');
  const expectedEurIncrease = Number((markupUsd * eurRate).toFixed(2));
  const actualEurIncrease = Number((quotedEur.basePrice - baselineEur.basePrice).toFixed(2));
  // Allow ±0.01 because each base is rounded separately
  assert.ok(Math.abs(actualEurIncrease - expectedEurIncrease) <= 0.01);
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
    ...DEFAULTS_Sept2025,
    renewPrices: { com: customRenewUsd },
  });
  const renew = await dp.getPrice('com', 'USD', { transaction: 'renew' });
  assert.equal(renew.basePrice, customRenewUsd);
});
