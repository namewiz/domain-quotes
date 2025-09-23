#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_URL = process.env.OPENPROVIDER_BASE_URL || 'https://api.openprovider.eu';
const USERNAME = process.env.OPENPROVIDER_USERNAME;
const PASSWORD = process.env.OPENPROVIDER_PASSWORD;

if (!USERNAME || !PASSWORD) {
  console.error('Missing OPENPROVIDER_USERNAME or OPENPROVIDER_PASSWORD');
  process.exit(1);
}

const POPULAR_TLDS = [
  'africa',
  'ai',
  'app',
  'art',
  'biz',
  'blog',
  'cc',
  'co',
  'com',
  'dev',
  'gg',
  'inc',
  'info',
  'io',
  'live',
  'me',
  'name',
  'net',
  'online',
  'org',
  'pro',
  'sh',
  'shop',
  'store',
  'tech',
  'to',
  'tv',
  'xyz',
];

let authToken = null;

async function authenticateWithOpenProvider() {
  const requestBody = {
    username: USERNAME,
    password: PASSWORD,
    ip: '0.0.0.0',
  };

  const response = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    const msg = data.desc || response.statusText;
    throw new Error(`OpenProvider auth error: ${response.status} ${msg}`);
  }

  return data.data.token;
}

async function checkDomainPricing(domains) {
  const requestBody = {
    domains: domains,
    with_price: true,
  };

  const response = await fetch(`${API_URL}/domains/check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(requestBody),
  });

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    const msg = data.desc || response.statusText;
    throw new Error(`OpenProvider domains/check error: ${response.status} ${msg}`);
  }

  return data.data.results;
}

function convertToUSD(price, currency, exchangeRates) {
  if (currency === 'USD') {
    return price;
  }

  const exchangeRateEntry = exchangeRates.find((rate) => rate.currencyCode === currency);
  if (!exchangeRateEntry) {
    console.warn(`Exchange rate not found for ${currency}, using original price`);
    return price;
  }

  // Convert to USD using the inverse rate (since exchange rates are from USD to other currencies)
  return price * exchangeRateEntry.inverseRate;
}

async function loadExchangeRates() {
  const exchangeRatesPath = path.resolve(__dirname, '../data/exchange-rates.json');
  const exchangeRatesData = await fs.readFile(exchangeRatesPath, 'utf8');
  return JSON.parse(exchangeRatesData);
}

async function run() {
  console.log('Authenticating with OpenProvider...');
  authToken = await authenticateWithOpenProvider();
  console.log('Authentication successful');

  console.log('Loading exchange rates...');
  const exchangeRates = await loadExchangeRates();
  console.log(`Loaded ${exchangeRates.length} exchange rates`);

  console.log('\nFetching pricing for popular TLDs...');

  const prices = {};

  // Process TLDs in batches to avoid rate limiting
  let batchSize = 10;
  for (let i = 0; i < POPULAR_TLDS.length; i += batchSize) {
    const batch = POPULAR_TLDS.slice(i, i + batchSize);
    console.log(
      `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(POPULAR_TLDS.length / batchSize)}: ${batch.join(', ')}`
    );

    // Create domain check requests for this batch
    const domains = batch.map((tld) => ({
      extension: tld,
      name: `random-generated-string-123456`,
    }));

    try {
      const results = await checkDomainPricing(domains);

      for (const result of results) {
        const tld = result.domain.split('.')[1];

        if (result.price) {
          const productPrice = result.price.product;
          const resellerPrice = result.price.reseller;

          // Convert prices to USD
          const productPriceUSD = convertToUSD(productPrice.price, productPrice.currency, exchangeRates);
          const resellerPriceUSD = convertToUSD(resellerPrice.price, resellerPrice.currency, exchangeRates);

          prices[tld] = {
            productPrice: Math.round(productPriceUSD * 100) / 100, // Round to 2 decimal places
            resellerPrice: Math.round(resellerPriceUSD * 100) / 100, // Round to 2 decimal places
          };
          console.log(`  ${tld}: Product $${prices[tld].productPrice}, Reseller $${prices[tld].resellerPrice}`);
        } else {
          console.log(`  ${tld}: No pricing available`);
          prices[tld] = null;
        }
      }

      // Add a small delay between batches to be respectful to the API
      if (i + batchSize < POPULAR_TLDS.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`Error processing batch: ${error.message}`);

      // Try processing individual TLDs from failed batch if batch size > 1
      if (batchSize > 1) {
        console.log('Retrying failed TLDs individually...');
        for (const tld of batch) {
          try {
            const domains = [
              {
                extension: tld,
                name: `random-generated-string-123456`,
              },
            ];

            const results = await checkDomainPricing(domains);
            const result = results[0];

            if (result && result.price) {
              const productPrice = result.price.product;
              const resellerPrice = result.price.reseller;

              // Convert prices to USD
              const productPriceUSD = convertToUSD(productPrice.price, productPrice.currency, exchangeRates);
              const resellerPriceUSD = convertToUSD(resellerPrice.price, resellerPrice.currency, exchangeRates);

              prices[tld] = {
                productPrice: Math.round(productPriceUSD * 100) / 100,
                resellerPrice: Math.round(resellerPriceUSD * 100) / 100,
              };
              console.log(`  ${tld}: Product $${prices[tld].productPrice}, Reseller $${prices[tld].resellerPrice}`);
            } else {
              console.log(`  ${tld}: No pricing available`);
              prices[tld] = null;
            }

            // Small delay between individual requests
            await new Promise((resolve) => setTimeout(resolve, 500));
          } catch (individualError) {
            console.error(`  ${tld}: ${individualError.message}`);
            prices[tld] = null;
          }
        }
      } else {
        // Mark all TLDs in this batch as failed
        batch.forEach((tld) => {
          prices[tld] = null;
        });
      }
    }
  }

  // Sort prices by TLD key before saving for consistent output
  const sortedPrices = Object.keys(prices)
    .sort()
    .reduce((acc, tld) => {
      acc[tld] = prices[tld];
      return acc;
    }, {});

  const dest = path.resolve(__dirname, '../data/openprovider-prices.json');
  await fs.writeFile(dest, JSON.stringify(sortedPrices, null, 2));

  const successfulPrices = Object.values(prices).filter((p) => p !== null).length;
  console.log(`\nPricing data saved to ${dest}`);
  console.log(`Total TLDs processed: ${POPULAR_TLDS.length}`);
  console.log(`TLDs with pricing: ${successfulPrices}`);
  console.log(`TLDs without pricing: ${POPULAR_TLDS.length - successfulPrices}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
