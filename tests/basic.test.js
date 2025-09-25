import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getDefaultPrice,
  isSupportedExtension,
  isSupportedCurrency,
  listSupportedCurrencies,
  listSupportedExtensions,
  UnsupportedExtensionError,
  UnsupportedCurrencyError,
} from '../dist/index.js';

test('supported currency list contains core set', () => {
  const list = listSupportedCurrencies();
  assert.ok(Array.isArray(list));
  ['USD', 'GBP', 'EUR', 'NGN'].forEach((c) => assert.ok(list.includes(c)));
});

test('supported extensions includes com and excludes io (in data set)', () => {
  const list = listSupportedExtensions();
  assert.ok(list.includes('com'));
  // openprovider-prices.json has null for io, should be unsupported
  assert.ok(!list.includes('io'));
  assert.equal(isSupportedExtension('com'), true);
  assert.equal(isSupportedExtension('example.com'), true);
  assert.equal(isSupportedExtension('io'), false);
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
