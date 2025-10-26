import discountsJson from './data/discount.json' assert { type: 'json' };
import vatRatesJson from './data/vat-rates.json' assert { type: 'json' };

export interface PriceQuote {
  extension: string;
  currency: string;
  basePrice: number;
  discount: number;
  tax: number;
  totalPrice: number;
  symbol: string;
  transaction: TransactionType;
}

export type MarkupType = 'percentage' | 'fixedUsd';

export interface PriceMarkup {
  type: MarkupType;
  value: number;
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
export type TransactionType = 'create' | 'renew' | 'restore' | 'transfer';

export interface GetPriceOptions {
  discountCodes?: string[];
  now?: number | Date;
  discountPolicy?: DiscountPolicy;
  transaction?: TransactionType; // default: 'create'
}

export interface DomainPricesConfig {
  createPrices: Record<string, number>;
  // Optional alternative price tables by transaction type (USD). Falls back to `createPrices` when not provided.
  renewPrices?: Record<string, number>;
  restorePrices?: Record<string, number>;
  transferPrices?: Record<string, number>;
  exchangeRates: ExchangeRateData[];
  vatRates: VatRates;
  discounts: Record<string, DiscountConfig>;
  markup?: PriceMarkup;
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
  const prices = loadPrices();
  return Object.keys(prices).sort();
}

export function isSupportedExtension(extOrDomain: string): boolean {
  const prices = loadPrices();
  const ext = normalizeExtensionOrDomainUsing(prices, extOrDomain);
  const value = prices[ext];
  return typeof value === 'number' && value > 0;
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

// Remote data sources
const UNIFIED_CREATE_PRICES_CSV =
  'https://raw.githubusercontent.com/namewiz/registrar-pricelist/refs/heads/main/data/unified-create-prices.csv';
const EXCHANGE_RATES_JSON_URL =
  'https://raw.githubusercontent.com/namewiz/registrar-pricelist/refs/heads/main/data/exchange-rates.json';

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  return res.text();
}

async function fetchJson<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

function parseUnifiedPricesCsv(csv: string): Record<string, number> {
  // CSV columns: tld,provider,amount
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return {};
  const header = lines.shift()!; // remove header
  // Accept header validation lightly (avoid strict coupling)
  const result: Record<string, number> = {};
  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length < 3) continue;
    const tld = parts[0]?.trim().toLowerCase();
    // const provider = parts[1]?.trim().toLowerCase(); // not currently used
    const amountStr = parts[2]?.trim();
    const amount = Number(amountStr);
    if (!tld || !Number.isFinite(amount) || amount <= 0) continue;
    // Use the lowest amount across providers for each TLD
    if (!(tld in result) || amount < result[tld]) {
      result[tld] = amount;
    }
  }
  return result;
}

// Fetch remote datasets once at module load (Node ESM supports top-level await)
const [CREATE_PRICES, EXCHANGE_RATES] = await Promise.all([
  fetchText(UNIFIED_CREATE_PRICES_CSV).then(parseUnifiedPricesCsv),
  fetchJson<ExchangeRateData[]>(EXCHANGE_RATES_JSON_URL),
]);

function loadPrices(): Record<string, number> {
  return CREATE_PRICES;
}

function loadExchangeRates(): ExchangeRateData[] {
  return EXCHANGE_RATES;
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

function applyMarkup(baseUsd: number, markup?: PriceMarkup): number {
  if (!markup) return baseUsd;
  const value = typeof markup.value === 'number' ? markup.value : 0;
  if (!Number.isFinite(value) || value <= 0) return baseUsd;
  switch (markup.type) {
    case 'percentage':
      return baseUsd + (baseUsd * value);
    case 'fixedUsd':
      return baseUsd + value;
    default:
      return baseUsd;
  }
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
    const createPrices = this.config.createPrices;
    const vatRates = this.config.vatRates;
    const discounts = this.config.discounts;

    const ext = normalizeExtensionOrDomainUsing(createPrices, extension);
    const tx: TransactionType = options.transaction || 'create';
    // Select base USD using transaction-specific table when available; otherwise fallback to default `createPrices`.
    let baseUsd: number | undefined;
    switch (tx) {
      case 'renew':
        baseUsd = this.config.renewPrices?.[ext] ?? createPrices[ext];
        break;
      case 'restore':
        baseUsd = this.config.restorePrices?.[ext] ?? createPrices[ext];
        break;
      case 'transfer':
        baseUsd = this.config.transferPrices?.[ext] ?? createPrices[ext];
        break;
      case 'create':
      default:
        baseUsd = createPrices[ext];
        break;
    }
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
    const markedUsd = applyMarkup(baseUsd, this.config.markup);
    const basePrice = round2(markedUsd * rateInfo.exchangeRate);

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

    return { extension: ext, currency, basePrice, discount, tax, totalPrice, symbol, transaction: tx };
  }
}

// Build default config snapshot from the bundled JSON data.
export const DEFAULT_RATES: DomainPricesConfig = {
  createPrices: loadPrices(),
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
  const dp = new DomainPrices(DEFAULT_RATES);
  return dp.getPrice(extension, currencyCode, options);
}
