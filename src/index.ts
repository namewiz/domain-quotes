import discountsJson from './data/discount.json' assert { type: 'json' };
import exchangeRatesJson from './data/exchange-rates.json' assert { type: 'json' };
import openProviderPricesJson from './data/openprovider-prices.json' assert { type: 'json' };
import vatRatesJson from './data/vat-rates.json' assert { type: 'json' };

interface PriceResult {
  extension: string;
  currency: string;
  basePrice: number;
  tax: number;
  discount: number;
  totalPrice: number;
  symbol: string;
}

interface ExchangeRateData {
  countryCode: string;
  currencyName: string;
  currencySymbol: string;
  currencyCode: string;
  exchangeRate: number;
  inverseRate: number;
}

type VatRates = Record<string, number>;

interface DiscountConfig {
  rate: number;
  extensions: string[];
  startAt: string;
  endAt: string;
}

async function loadPrices(): Promise<Record<string, number>> {
  const raw = openProviderPricesJson as Record<string, { productPrice?: number } | null | undefined>;
  const result: Record<string, number> = {};
  Object.entries(raw).forEach(([ext, info]) => {
    if (!info) return;
    const value = info.productPrice;
    if (value === undefined || value === null || value === 0) return;
    result[ext] = value;
  });
  return result;
}

async function loadExchangeRates(): Promise<ExchangeRateData[]> {
  return exchangeRatesJson as ExchangeRateData[];
}

async function loadVatRates(): Promise<VatRates> {
  return vatRatesJson as VatRates;
}

async function loadDiscounts(): Promise<Record<string, DiscountConfig>> {
  return discountsJson as Record<string, DiscountConfig>;
}

export async function getPrice(
  extension: string,
  currencyCode: string,
  discountCodes: string[] = []
): Promise<PriceResult> {
  const prices = await loadPrices();
  const exchangeRates = await loadExchangeRates();
  const vatRates = await loadVatRates();
  const discounts = await loadDiscounts();

  const ext = extension.replace(/^\./, '').toLowerCase();
  if (prices[ext] === undefined) {
    throw new Error(400, `Unsupported extension: ${ext}. No price defined.`);
  }
  const baseUsd = prices[ext];
  if (baseUsd === 0) {
    throw new Error(400, `Unsupported extension ${ext}. No USD price defined.`);
  }

  const currency = currencyCode.toUpperCase();
  const currencyToCountry: Record<string, string> = {
    USD: 'US',
    GBP: 'GB',
    EUR: 'DE',
    NGN: 'NG',
  };
  const iso = currencyToCountry[currency];
  if (!iso) {
    throw new Error(400, `Unsupported currency ${currencyCode}`);
  }

  const taxRate = vatRates[iso];
  if (taxRate === undefined) {
    throw new Error(400, `Unsupported currency ${currencyCode}`);
  }

  let rateInfo = exchangeRates.find((r) => r.currencyCode === currency);
  if (!rateInfo) {
    if (currency === 'USD') {
      rateInfo = {
        countryCode: 'US',
        currencyName: 'United States Dollar',
        currencySymbol: '$',
        currencyCode: 'USD',
        exchangeRate: 1,
        inverseRate: 1,
      };
    } else {
      throw new Error(400, `Unsupported currency ${currencyCode}`);
    }
  }

  const symbol = rateInfo.currencySymbol;

  const basePrice = +(baseUsd * rateInfo.exchangeRate).toFixed(2);

  let discount = 0;
  if (discountCodes.length > 0) {
    const uniqueCodes = Array.from(new Set(discountCodes.map((c) => c.toUpperCase())));
    const now = Date.now();
    uniqueCodes.forEach((code) => {
      const conf = discounts[code];
      if (!conf) return;
      const start = Date.parse(conf.startAt);
      const end = Date.parse(conf.endAt);
      if (Number.isNaN(start) || Number.isNaN(end)) return;
      if (now < start || now > end) return;
      if (!conf.extensions.includes(ext)) return;
      discount += basePrice * conf.rate;
    });
    discount = +discount.toFixed(2);
  }
  // TODO: update policy to apply only one discount, the highest.
  if (discount > basePrice) {
    discount = basePrice;
  }

  const subtotal = +(basePrice - discount).toFixed(2);
  const tax = +(subtotal * taxRate).toFixed(2);
  const totalPrice = +(subtotal + tax).toFixed(2);

  return {
    extension: ext,
    currency: currencyCode,
    basePrice,
    tax,
    discount,
    totalPrice,
    symbol,
  };
}
