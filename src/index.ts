import discountsJson from './data/discount.json' assert { type: 'json' };
import type {
  DiscountConfig,
  DomainQuoteConfig,
  ExchangeRateData,
  GetQuoteOptions,
  Markup,
  Quote,
  TransactionType
} from './types';
export type {
  DiscountConfig,
  DiscountPolicy, DomainQuoteConfig, ExchangeRateData, GetQuoteOptions, Markup, MarkupType, Quote, TransactionType
} from './types';

export const DEFAULT_VAT_RATE = 0.075;

export function listSupportedCurrencies(): string[] {
  // Use the configured default when available; fall back to core set
  return (DEFAULT_CONFIG.supportedCurrencies ?? ['USD', 'NGN']).slice();
}

export function isSupportedCurrency(code: string): boolean {
  if (!code) return false;
  const upper = code.toUpperCase();
  const list = listSupportedCurrencies();
  return list.includes(upper);
}

export function listSupportedExtensions(): string[] {
  const prices = loadPrices();
  return Object.keys(prices).sort();
}

export function isSupportedExtension(extension: string): boolean {
  const prices = loadPrices();
  const ext = normalizeExtension(extension);
  const value = prices[ext];
  return typeof value === 'number' && value > 0;
}

function normalizeExtension(extension: string): string {
  if (!extension) return extension as string;
  const lower = extension.trim().toLowerCase();
  // Strip any leading dots only (e.g. ".com", "..com" -> "com").
  return lower.replace(/^\.+/, '');
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

function loadDiscounts(): Record<string, DiscountConfig> {
  return discountsJson as Record<string, DiscountConfig>;
}

class DomainQuoteError extends Error {
  code: string;
  constructor (code: string, message: string) {
    super(message);
    this.name = 'DomainQuoteError';
    this.code = code;
  }
}

export class UnsupportedExtensionError extends DomainQuoteError {
  constructor (ext: string) {
    super('ERR_UNSUPPORTED_EXTENSION', `Unsupported extension: ${ext}`);
    this.name = 'UnsupportedExtensionError';
  }
}

export class UnsupportedCurrencyError extends DomainQuoteError {
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
  return Number(n.toFixed(2));
}

function applyMarkup(baseUsd: number, markup?: Markup): number {
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

export class DomainQuotes {
  private readonly config: DomainQuoteConfig;

  constructor (config: DomainQuoteConfig) {
    this.config = config;
  }

  private findRateInfo(currency: string): ExchangeRateData {
    if (currency === 'USD') return findUsdRateInfo();
    const found = this.config.exchangeRates.find((r) => r.currencyCode === currency);
    if (!found) throw new UnsupportedCurrencyError(currency);
    return found;
  }

  async getQuote(
    extension: string,
    currencyCode: string,
    options: GetQuoteOptions = {}
  ): Promise<Quote> {
    const createPrices = this.config.createPrices;
    const vatRate = typeof this.config.vatRate === 'number' ? this.config.vatRate : DEFAULT_VAT_RATE;
    const discounts = this.config.discounts;

    const ext = normalizeExtension(extension);
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
    const supported = this.config.supportedCurrencies ?? ['USD', 'NGN'];
    if (!supported.includes(currency)) {
      throw new UnsupportedCurrencyError(currencyCode);
    }

    const rateInfo = this.findRateInfo(currency);
    const symbol = rateInfo.currencySymbol;
    const markedUsd = applyMarkup(baseUsd, this.config.markup);
    const basePrice = round2(markedUsd * rateInfo.exchangeRate);

    const taxRate = vatRate;

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
export const DEFAULT_CONFIG: DomainQuoteConfig = {
  createPrices: loadPrices(),
  exchangeRates: loadExchangeRates(),
  vatRate: DEFAULT_VAT_RATE,
  discounts: loadDiscounts(),
  supportedCurrencies: ['USD', 'NGN'],
};

export async function getDefaultQuote(
  extension: string,
  currencyCode: string,
  options: GetQuoteOptions = {}
): Promise<Quote> {
  const dq = new DomainQuotes(DEFAULT_CONFIG);
  return dq.getQuote(extension, currencyCode, options);
}
