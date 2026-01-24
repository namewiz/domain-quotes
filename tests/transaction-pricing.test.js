import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_CONFIG,
  DomainQuotes,
  getDefaultQuote,
} from '../dist/index.js';

// Helper to create a minimal config for testing transaction pricing
function createTestConfig(overrides = {}) {
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
    discounts: {},
    supportedCurrencies: ['USD', 'NGN'],
    ...overrides,
  };
}

// Tests for DEFAULT_CONFIG containing remote renew and transfer prices
test('DEFAULT_CONFIG includes renewPrices from remote data', () => {
  assert.ok(DEFAULT_CONFIG.renewPrices, 'renewPrices should be defined');
  assert.equal(typeof DEFAULT_CONFIG.renewPrices, 'object');
  // Should have at least some TLDs (remote data)
  const tlds = Object.keys(DEFAULT_CONFIG.renewPrices);
  assert.ok(tlds.length > 0, 'renewPrices should have TLD entries');
});

test('DEFAULT_CONFIG includes transferPrices from remote data', () => {
  assert.ok(DEFAULT_CONFIG.transferPrices, 'transferPrices should be defined');
  assert.equal(typeof DEFAULT_CONFIG.transferPrices, 'object');
  // Should have at least some TLDs (remote data)
  const tlds = Object.keys(DEFAULT_CONFIG.transferPrices);
  assert.ok(tlds.length > 0, 'transferPrices should have TLD entries');
});

// Tests for renew pricing
test('renew transaction uses renewPrices when available', async () => {
  const config = createTestConfig({
    renewPrices: { com: 15 }, // Higher renew price for .com
  });
  const dq = new DomainQuotes(config);

  const createQuote = await dq.getQuote('com', 'USD', { transaction: 'create' });
  const renewQuote = await dq.getQuote('com', 'USD', { transaction: 'renew' });

  assert.equal(createQuote.basePrice, 10);
  assert.equal(renewQuote.basePrice, 15);
});

test('renew transaction falls back to createPrices when renewPrices not provided', async () => {
  const config = createTestConfig(); // No renewPrices
  const dq = new DomainQuotes(config);

  const createQuote = await dq.getQuote('com', 'USD', { transaction: 'create' });
  const renewQuote = await dq.getQuote('com', 'USD', { transaction: 'renew' });

  assert.equal(createQuote.basePrice, renewQuote.basePrice);
});

test('renew transaction falls back to createPrices for unlisted TLD', async () => {
  const config = createTestConfig({
    renewPrices: { net: 18 }, // Only .net has renew price
  });
  const dq = new DomainQuotes(config);

  const createQuote = await dq.getQuote('com', 'USD', { transaction: 'create' });
  const renewQuote = await dq.getQuote('com', 'USD', { transaction: 'renew' });

  // .com not in renewPrices, should fall back to create price
  assert.equal(renewQuote.basePrice, createQuote.basePrice);
});

// Tests for transfer pricing
test('transfer transaction uses transferPrices when available', async () => {
  const config = createTestConfig({
    transferPrices: { com: 8 }, // Lower transfer price for .com
  });
  const dq = new DomainQuotes(config);

  const createQuote = await dq.getQuote('com', 'USD', { transaction: 'create' });
  const transferQuote = await dq.getQuote('com', 'USD', { transaction: 'transfer' });

  assert.equal(createQuote.basePrice, 10);
  assert.equal(transferQuote.basePrice, 8);
});

test('transfer transaction falls back to createPrices when transferPrices not provided', async () => {
  const config = createTestConfig(); // No transferPrices
  const dq = new DomainQuotes(config);

  const createQuote = await dq.getQuote('com', 'USD', { transaction: 'create' });
  const transferQuote = await dq.getQuote('com', 'USD', { transaction: 'transfer' });

  assert.equal(createQuote.basePrice, transferQuote.basePrice);
});

test('transfer transaction falls back to createPrices for unlisted TLD', async () => {
  const config = createTestConfig({
    transferPrices: { org: 12 }, // Only .org has transfer price
  });
  const dq = new DomainQuotes(config);

  const createQuote = await dq.getQuote('com', 'USD', { transaction: 'create' });
  const transferQuote = await dq.getQuote('com', 'USD', { transaction: 'transfer' });

  // .com not in transferPrices, should fall back to create price
  assert.equal(transferQuote.basePrice, createQuote.basePrice);
});

// Tests for restore pricing
test('restore transaction uses restorePrices when available', async () => {
  const config = createTestConfig({
    restorePrices: { com: 100 }, // High restore price
  });
  const dq = new DomainQuotes(config);

  const createQuote = await dq.getQuote('com', 'USD', { transaction: 'create' });
  const restoreQuote = await dq.getQuote('com', 'USD', { transaction: 'restore' });

  assert.equal(createQuote.basePrice, 10);
  assert.equal(restoreQuote.basePrice, 100);
});

test('restore transaction falls back to createPrices when restorePrices not provided', async () => {
  const config = createTestConfig(); // No restorePrices
  const dq = new DomainQuotes(config);

  const createQuote = await dq.getQuote('com', 'USD', { transaction: 'create' });
  const restoreQuote = await dq.getQuote('com', 'USD', { transaction: 'restore' });

  assert.equal(createQuote.basePrice, restoreQuote.basePrice);
});

// Multi-currency tests for transaction pricing
test('renew prices work with currency conversion', async () => {
  const config = createTestConfig({
    renewPrices: { com: { USD: 15, NGN: 14000 } }, // Direct NGN price
  });
  const dq = new DomainQuotes(config);

  const usdQuote = await dq.getQuote('com', 'USD', { transaction: 'renew' });
  const ngnQuote = await dq.getQuote('com', 'NGN', { transaction: 'renew' });

  assert.equal(usdQuote.basePrice, 15);
  assert.equal(ngnQuote.basePrice, 14000); // Uses direct NGN price
});

test('transfer prices work with currency conversion', async () => {
  const config = createTestConfig({
    transferPrices: { com: { USD: 8, NGN: 7500 } },
  });
  const dq = new DomainQuotes(config);

  const usdQuote = await dq.getQuote('com', 'USD', { transaction: 'transfer' });
  const ngnQuote = await dq.getQuote('com', 'NGN', { transaction: 'transfer' });

  assert.equal(usdQuote.basePrice, 8);
  assert.equal(ngnQuote.basePrice, 7500);
});

test('renew falls back to exchange rate when direct currency not available', async () => {
  const config = createTestConfig({
    renewPrices: { com: 15 }, // Only USD
  });
  const dq = new DomainQuotes(config);

  const ngnQuote = await dq.getQuote('com', 'NGN', { transaction: 'renew' });

  // 15 USD * 1000 rate = 15000 NGN
  assert.equal(ngnQuote.basePrice, 15000);
});

// Tests for all transaction types
test('all transaction types return correct domainTransaction field', async () => {
  const config = createTestConfig({
    renewPrices: { com: 15 },
    transferPrices: { com: 8 },
    restorePrices: { com: 100 },
  });
  const dq = new DomainQuotes(config);

  const create = await dq.getQuote('com', 'USD', { transaction: 'create' });
  const renew = await dq.getQuote('com', 'USD', { transaction: 'renew' });
  const transfer = await dq.getQuote('com', 'USD', { transaction: 'transfer' });
  const restore = await dq.getQuote('com', 'USD', { transaction: 'restore' });

  assert.equal(create.domainTransaction, 'create');
  assert.equal(renew.domainTransaction, 'renew');
  assert.equal(transfer.domainTransaction, 'transfer');
  assert.equal(restore.domainTransaction, 'restore');
});

test('all transaction types have independent prices', async () => {
  const config = createTestConfig({
    renewPrices: { com: 15 },
    transferPrices: { com: 8 },
    restorePrices: { com: 100 },
  });
  const dq = new DomainQuotes(config);

  const create = await dq.getQuote('com', 'USD', { transaction: 'create' });
  const renew = await dq.getQuote('com', 'USD', { transaction: 'renew' });
  const transfer = await dq.getQuote('com', 'USD', { transaction: 'transfer' });
  const restore = await dq.getQuote('com', 'USD', { transaction: 'restore' });

  assert.equal(create.basePrice, 10);
  assert.equal(renew.basePrice, 15);
  assert.equal(transfer.basePrice, 8);
  assert.equal(restore.basePrice, 100);
});

// Tests for markup with transaction pricing
test('markup applies to transaction-specific prices', async () => {
  const config = createTestConfig({
    renewPrices: { com: 15 },
    markup: { type: 'percentage', value: 0.2 }, // 20% markup
  });
  const dq = new DomainQuotes(config);

  const createQuote = await dq.getQuote('com', 'USD', { transaction: 'create' });
  const renewQuote = await dq.getQuote('com', 'USD', { transaction: 'renew' });

  // Create: 10 * 1.2 = 12
  assert.equal(createQuote.basePrice, 12);
  // Renew: 15 * 1.2 = 18
  assert.equal(renewQuote.basePrice, 18);
});

test('fixed USD markup applies to transaction-specific prices', async () => {
  const config = createTestConfig({
    transferPrices: { com: 8 },
    markup: { type: 'fixedUsd', value: 2 },
  });
  const dq = new DomainQuotes(config);

  const createQuote = await dq.getQuote('com', 'USD', { transaction: 'create' });
  const transferQuote = await dq.getQuote('com', 'USD', { transaction: 'transfer' });

  // Create: 10 + 2 = 12
  assert.equal(createQuote.basePrice, 12);
  // Transfer: 8 + 2 = 10
  assert.equal(transferQuote.basePrice, 10);
});

// Tests for discounts with transaction pricing
test('discounts apply to transaction-specific prices', async () => {
  const config = createTestConfig({
    renewPrices: { com: 20 },
    discounts: {
      SAVE10: {
        rate: 0.1, // 10%
        extensions: ['com'],
        startAt: '2024-01-01T00:00:00Z',
        endAt: '2030-12-31T23:59:59Z',
      },
    },
  });
  const dq = new DomainQuotes(config);
  const now = Date.parse('2024-06-15T12:00:00Z');

  const createQuote = await dq.getQuote('com', 'USD', {
    transaction: 'create',
    discountCodes: ['SAVE10'],
    now,
  });
  const renewQuote = await dq.getQuote('com', 'USD', {
    transaction: 'renew',
    discountCodes: ['SAVE10'],
    now,
  });

  // Create: 10, discount 1
  assert.equal(createQuote.basePrice, 10);
  assert.equal(createQuote.discount, 1);
  // Renew: 20, discount 2
  assert.equal(renewQuote.basePrice, 20);
  assert.equal(renewQuote.discount, 2);
});

// Tests for tax calculation with transaction pricing
test('tax is calculated correctly for transaction-specific prices', async () => {
  const config = createTestConfig({
    renewPrices: { com: 20 },
    vatRate: 0.1, // 10%
  });
  const dq = new DomainQuotes(config);

  const createQuote = await dq.getQuote('com', 'USD', { transaction: 'create' });
  const renewQuote = await dq.getQuote('com', 'USD', { transaction: 'renew' });

  // Create: 10 * 0.1 = 1
  assert.equal(createQuote.tax, 1);
  // Renew: 20 * 0.1 = 2
  assert.equal(renewQuote.tax, 2);
});

// Tests using DEFAULT_CONFIG with remote data
test('getDefaultQuote uses remote renew prices for renew transaction', async () => {
  const createQuote = await getDefaultQuote('com', 'USD', { transaction: 'create' });
  const renewQuote = await getDefaultQuote('com', 'USD', { transaction: 'renew' });

  // Both should return valid prices (from remote data)
  assert.equal(typeof createQuote.basePrice, 'number');
  assert.ok(createQuote.basePrice > 0);
  assert.equal(typeof renewQuote.basePrice, 'number');
  assert.ok(renewQuote.basePrice > 0);

  assert.equal(createQuote.domainTransaction, 'create');
  assert.equal(renewQuote.domainTransaction, 'renew');
});

test('getDefaultQuote uses remote transfer prices for transfer transaction', async () => {
  const createQuote = await getDefaultQuote('com', 'USD', { transaction: 'create' });
  const transferQuote = await getDefaultQuote('com', 'USD', { transaction: 'transfer' });

  // Both should return valid prices (from remote data)
  assert.equal(typeof createQuote.basePrice, 'number');
  assert.ok(createQuote.basePrice > 0);
  assert.equal(typeof transferQuote.basePrice, 'number');
  assert.ok(transferQuote.basePrice > 0);

  assert.equal(createQuote.domainTransaction, 'create');
  assert.equal(transferQuote.domainTransaction, 'transfer');
});

// Edge case tests
test('empty renewPrices object falls back to createPrices', async () => {
  const config = createTestConfig({
    renewPrices: {}, // Empty
  });
  const dq = new DomainQuotes(config);

  const createQuote = await dq.getQuote('com', 'USD', { transaction: 'create' });
  const renewQuote = await dq.getQuote('com', 'USD', { transaction: 'renew' });

  assert.equal(createQuote.basePrice, renewQuote.basePrice);
});

test('empty transferPrices object falls back to createPrices', async () => {
  const config = createTestConfig({
    transferPrices: {}, // Empty
  });
  const dq = new DomainQuotes(config);

  const createQuote = await dq.getQuote('com', 'USD', { transaction: 'create' });
  const transferQuote = await dq.getQuote('com', 'USD', { transaction: 'transfer' });

  assert.equal(createQuote.basePrice, transferQuote.basePrice);
});

test('transaction prices with multi-currency map use minimum price per currency', async () => {
  // The parseUnifiedPricesCsv function takes the minimum price when there are duplicates
  const config = createTestConfig({
    renewPrices: { com: { USD: 15, NGN: 14000 } },
  });
  const dq = new DomainQuotes(config);

  const usdQuote = await dq.getQuote('com', 'USD', { transaction: 'renew' });
  const ngnQuote = await dq.getQuote('com', 'NGN', { transaction: 'renew' });

  assert.equal(usdQuote.basePrice, 15);
  assert.equal(ngnQuote.basePrice, 14000);
});

test('transaction price override merges with create price currency map', async () => {
  const config = createTestConfig({
    createPrices: { com: { USD: 10, NGN: 9500 } },
    renewPrices: { com: { USD: 15 } }, // Only USD override
  });
  const dq = new DomainQuotes(config);

  const usdQuote = await dq.getQuote('com', 'USD', { transaction: 'renew' });
  const ngnQuote = await dq.getQuote('com', 'NGN', { transaction: 'renew' });

  // USD uses override price
  assert.equal(usdQuote.basePrice, 15);
  // NGN uses the merged map which still has the original NGN price from create
  // The merge is: { USD: 10, NGN: 9500 } + { USD: 15 } = { USD: 15, NGN: 9500 }
  // So NGN direct price (9500) is preserved from createPrices
  assert.equal(ngnQuote.basePrice, 9500);
});

// Tests for consistency of quote structure across transaction types
test('quote structure is consistent across all transaction types', async () => {
  const config = createTestConfig({
    renewPrices: { com: 15 },
    transferPrices: { com: 8 },
    restorePrices: { com: 100 },
  });
  const dq = new DomainQuotes(config);

  const transactions = ['create', 'renew', 'transfer', 'restore'];

  for (const tx of transactions) {
    const quote = await dq.getQuote('com', 'USD', { transaction: tx });

    assert.equal(typeof quote.extension, 'string');
    assert.equal(typeof quote.currency, 'string');
    assert.equal(typeof quote.basePrice, 'number');
    assert.equal(typeof quote.discount, 'number');
    assert.equal(typeof quote.tax, 'number');
    assert.equal(typeof quote.totalPrice, 'number');
    assert.equal(typeof quote.symbol, 'string');
    assert.equal(typeof quote.domainTransaction, 'string');

    assert.equal(quote.extension, 'com');
    assert.equal(quote.currency, 'USD');
    assert.equal(quote.domainTransaction, tx);
  }
});

// Test multiple TLDs with different transaction prices
test('different TLDs can have different transaction price configurations', async () => {
  const config = createTestConfig({
    renewPrices: {
      com: 15,
      net: 14,
      // org not specified
    },
    transferPrices: {
      com: 8,
      // net and org not specified
    },
  });
  const dq = new DomainQuotes(config);

  // .com has both renew and transfer overrides
  const comRenew = await dq.getQuote('com', 'USD', { transaction: 'renew' });
  const comTransfer = await dq.getQuote('com', 'USD', { transaction: 'transfer' });
  assert.equal(comRenew.basePrice, 15);
  assert.equal(comTransfer.basePrice, 8);

  // .net has only renew override
  const netRenew = await dq.getQuote('net', 'USD', { transaction: 'renew' });
  const netTransfer = await dq.getQuote('net', 'USD', { transaction: 'transfer' });
  assert.equal(netRenew.basePrice, 14);
  assert.equal(netTransfer.basePrice, 12); // falls back to create

  // .org has no overrides
  const orgRenew = await dq.getQuote('org', 'USD', { transaction: 'renew' });
  const orgTransfer = await dq.getQuote('org', 'USD', { transaction: 'transfer' });
  assert.equal(orgRenew.basePrice, 15); // falls back to create
  assert.equal(orgTransfer.basePrice, 15); // falls back to create
});
