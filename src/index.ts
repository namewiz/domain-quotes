import discountsJson from './data/discount.json' assert { type: 'json' };
import exchangeRatesJson from './data/exchange-rates.json' assert { type: 'json' };
import openProviderPricesJson from './data/openprovider-prices.json' assert { type: 'json' };
import vatRatesJson from './data/vat-rates.json' assert { type: 'json' };
// Removed tldts dependency; implement internal suffix resolution.

export interface PriceQuote {
  extension: string;
  currency: string;
  basePrice: number;
  discount: number;
  tax: number;
  totalPrice: number;
  symbol: string;
}

export interface ExchangeRateData {
  countryCode: string;
  currencyName: string;
  currencySymbol: string;
  currencyCode: string;
  exchangeRate: number;
  inverseRate: number;
}

type VatRates = Record<string, number>;

export interface DiscountConfig {
  rate: number;
  extensions: string[];
  startAt: string;
  endAt: string;
}

export type DiscountPolicy = 'stack' | 'max';

export interface GetPriceOptions {
  discountCodes?: string[];
  now?: number | Date;
  discountPolicy?: DiscountPolicy;
}

export interface DomainPricesConfig {
  prices: Record<string, number>;
  exchangeRates: ExchangeRateData[];
  vatRates: VatRates;
  discounts: Record<string, DiscountConfig>;
}

// Narrow, explicit support for VAT mapping by currency
const currencyToCountry: Record<string, string> = {
  USD: 'US',
  GBP: 'GB',
  EUR: 'DE',
  NGN: 'NG',
};

export function listSupportedCurrencies(): string[] {
  return Object.keys(currencyToCountry);
}

export function isSupportedCurrency(code: string): boolean {
  return code != null && currencyToCountry.hasOwnProperty(code.toUpperCase());
}

export function listSupportedExtensions(): string[] {
  const raw = openProviderPricesJson as Record<string, { productPrice?: number } | null | undefined>;
  return Object.entries(raw)
    .filter(([, info]) => info && typeof info.productPrice === 'number' && info.productPrice! > 0)
    .map(([ext]) => ext)
    .sort();
}

export function isSupportedExtension(extOrDomain: string): boolean {
  const ext = normalizeExtensionOrDomainUsing(loadPrices(), extOrDomain);
  const raw = openProviderPricesJson as Record<string, { productPrice?: number } | null | undefined>;
  const info = raw[ext];
  return Boolean(info && typeof info.productPrice === 'number' && info.productPrice! > 0);
}

function normalizeExtensionOrDomainUsing(prices: Record<string, number>, input: string): string {
  if (!input) return input as string;
  const lower = input.trim().toLowerCase();
  const cleaned = lower.replace(/^\.+/, '');
  if (!cleaned) return '';

  if (prices.hasOwnProperty(cleaned)) {
    // Exact extension provided (e.g. "com" or "com.ng")
    return cleaned;
  }

  if (cleaned.includes('.')) {
    const parts = cleaned.split('.');
    // Find the longest matching suffix present in prices
    for (let i = 0; i < parts.length; i++) {
      const suffix = parts.slice(i).join('.');
      if (prices.hasOwnProperty(suffix)) return suffix;
    }
    // Fallback to last label if nothing matches
    return parts[parts.length - 1];
  }

  return cleaned;
}

function asNowValue(now?: number | Date): number {
  if (now instanceof Date) return now.getTime();
  if (typeof now === 'number') return now;
  return Date.now();
}

function loadPrices(): Record<string, number> {
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

function loadExchangeRates(): ExchangeRateData[] {
  return exchangeRatesJson as ExchangeRateData[];
}

function loadVatRates(): VatRates {
  return vatRatesJson as VatRates;
}

function loadDiscounts(): Record<string, DiscountConfig> {
  return discountsJson as Record<string, DiscountConfig>;
}

class DomainPricesError extends Error {
  code: string;
  constructor (code: string, message: string) {
    super(message);
    this.name = 'DomainPricesError';
    this.code = code;
  }
}

export class UnsupportedExtensionError extends DomainPricesError {
  constructor (ext: string) {
    super('ERR_UNSUPPORTED_EXTENSION', `Unsupported extension: ${ext}`);
    this.name = 'UnsupportedExtensionError';
  }
}

export class UnsupportedCurrencyError extends DomainPricesError {
  constructor (currency: string) {
    super('ERR_UNSUPPORTED_CURRENCY', `Unsupported currency: ${currency}`);
    this.name = 'UnsupportedCurrencyError';
  }
}

function findUsdRateInfo(): ExchangeRateData {
  return {
    countryCode: 'US',
    currencyName: 'United States Dollar',
    currencySymbol: '$',
    currencyCode: 'USD',
    exchangeRate: 1,
    inverseRate: 1,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export class DomainPrices {
  private readonly config: DomainPricesConfig;

  constructor (config: DomainPricesConfig) {
    this.config = config;
  }

  private findRateInfo(currency: string): ExchangeRateData {
    if (currency === 'USD') return findUsdRateInfo();
    const found = this.config.exchangeRates.find((r) => r.currencyCode === currency);
    if (!found) throw new UnsupportedCurrencyError(currency);
    return found;
  }

  async getPrice(
    extension: string,
    currencyCode: string,
    options: GetPriceOptions = {}
  ): Promise<PriceQuote> {
    const prices = this.config.prices;
    const vatRates = this.config.vatRates;
    const discounts = this.config.discounts;

    const ext = normalizeExtensionOrDomainUsing(prices, extension);
    const baseUsd = prices[ext];
    if (baseUsd === undefined || baseUsd === 0) {
      throw new UnsupportedExtensionError(ext);
    }

    const currency = (currencyCode || '').toUpperCase();
    const iso = currencyToCountry[currency];
    if (!iso) {
      throw new UnsupportedCurrencyError(currencyCode);
    }
    const taxRate = vatRates[iso];
    if (typeof taxRate !== 'number') {
      throw new UnsupportedCurrencyError(currencyCode);
    }

    const rateInfo = this.findRateInfo(currency);
    const symbol = rateInfo.currencySymbol;
    const basePrice = round2(baseUsd * rateInfo.exchangeRate);

    const uniqueCodes = Array.from(new Set((options.discountCodes || []).map((c) => c.toUpperCase())));
    const nowMs = asNowValue(options.now);
    const applicable: number[] = [];
    for (const code of uniqueCodes) {
      const conf = discounts[code];
      if (!conf) continue;
      const start = Date.parse(conf.startAt);
      const end = Date.parse(conf.endAt);
      if (Number.isNaN(start) || Number.isNaN(end)) continue;
      if (nowMs < start || nowMs > end) continue;
      if (!conf.extensions.includes(ext)) continue;
      applicable.push(round2(basePrice * conf.rate));
    }

    let discount = 0;
    if (applicable.length > 0) {
      if (options.discountPolicy === 'stack') {
        discount = round2(applicable.reduce((a, b) => a + b, 0));
      } else {
        // default: apply only the highest discount
        discount = Math.max(...applicable);
      }
    }
    if (discount > basePrice) discount = basePrice;

    const subtotal = round2(basePrice - discount);
    const tax = round2(subtotal * taxRate);
    const totalPrice = round2(subtotal + tax);

    return { extension: ext, currency, basePrice, discount, tax, totalPrice, symbol };
  }
}

// Build default config snapshot from the bundled JSON data.
export const DEFAULTS_Sept2025: DomainPricesConfig = {
  prices: loadPrices(),
  exchangeRates: loadExchangeRates(),
  vatRates: loadVatRates(),
  discounts: loadDiscounts(),
};

// Back-compat wrapper that uses the default config
export async function getDefaultPrice(
  extension: string,
  currencyCode: string,
  options: GetPriceOptions = {}
): Promise<PriceQuote> {
  const dp = new DomainPrices(DEFAULTS_Sept2025);
  return dp.getPrice(extension, currencyCode, options);
}
