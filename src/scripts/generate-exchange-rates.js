#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COUNTRY_API_URL = process.env.COUNTRY_API_URL || 'https://restcountries.com/v3.1/all?fields=cca2,currencies';
const EXCHANGE_RATES_URL = process.env.EXCHANGE_RATES_URL || 'https://www.floatrates.com/daily/usd.json';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function run() {
  const [countries, rates] = await Promise.all([fetchJson(COUNTRY_API_URL), fetchJson(EXCHANGE_RATES_URL)]);

  const results = [];

  for (const country of countries) {
    const countryCode = country.cca2;
    if (!countryCode || !country.currencies) continue;

    for (const [currencyCode, details] of Object.entries(country.currencies)) {
      const rateInfo = rates[currencyCode.toLowerCase()];
      if (!rateInfo) {
        console.warn(`No rate found for ${currencyCode}`);
        continue;
      }
      results.push({
        countryCode,
        currencyName: details.name,
        currencySymbol: details.symbol,
        currencyCode,
        exchangeRate: rateInfo.rate,
        inverseRate: rateInfo.inverseRate,
      });
    }
  }

  const dest = path.resolve(__dirname, '../data/exchange-rates.json');
  await fs.writeFile(dest, JSON.stringify(results, null, 2));
  console.log(`Exchange rates saved to ${dest}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
