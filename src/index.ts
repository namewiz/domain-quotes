import type {
  DiscountConfig,
  DomainQuoteConfig,
  ExchangeRateData,
  GetQuoteOptions,
  Markup,
  PriceEntry,
  PriceTable,
  Quote,
  TransactionType
} from './types';
export type {
  DiscountConfig,
  DiscountEligibilityCallback,
  DiscountEligibilityContext,
  DiscountPolicy,
  DomainQuoteConfig,
  ExchangeRateData,
  GetQuoteOptions,
  Markup,
  MarkupType,
  PriceEntry,
  PriceTable,
  Quote,
  TransactionType
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

function toPriceMap(entry: PriceEntry | undefined): Record<string, number> | undefined {
  if (entry === undefined || entry === null) return undefined;
  if (typeof entry === 'number') {
    if (!Number.isFinite(entry) || entry <= 0) return undefined;
    return { USD: entry };
  }

  const map: Record<string, number> = {};
  for (const [code, value] of Object.entries(entry)) {
    const upper = code?.toUpperCase();
    if (!upper || !Number.isFinite(value) || value <= 0) continue;
    const existing = map[upper];
    map[upper] = existing === undefined ? value : Math.min(existing, value);
  }
  return Object.keys(map).length > 0 ? map : undefined;
}

function hasValidPrice(entry: PriceEntry | undefined): boolean {
  return !!toPriceMap(entry);
}

export function isSupportedExtension(extension: string): boolean {
  const prices = loadPrices();
  const ext = normalizeExtension(extension);
  const value = prices[ext];
  return hasValidPrice(value);
}

export function normalizeExtension(extension: string): string {
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
const UNIFIED_RENEW_PRICES_CSV =
  'https://raw.githubusercontent.com/namewiz/registrar-pricelist/refs/heads/main/data/unified-renew-prices.csv';
const UNIFIED_TRANSFER_PRICES_CSV =
  'https://raw.githubusercontent.com/namewiz/registrar-pricelist/refs/heads/main/data/unified-transfer-prices.csv';
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

function parseUnifiedPricesCsv(csv: string): PriceTable {
  // CSV columns: tld,provider,currency,amount
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return {};
  const header = lines.shift()!; // remove header
  // Accept header validation lightly (avoid strict coupling)
  const result: PriceTable = {};
  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length < 4) continue;
    const tld = parts[0]?.trim().toLowerCase();
    // const provider = parts[1]?.trim().toLowerCase(); // not currently used
    const currency = parts[2]?.trim().toUpperCase();
    const amountStr = parts[3]?.trim();
    const amount = Number(amountStr);
    if (!tld || !currency || !Number.isFinite(amount) || amount <= 0) continue;
    const existing = result[tld];
    let map: Record<string, number>;
    if (existing === undefined) {
      map = {};
    } else if (typeof existing === 'number') {
      map = { USD: existing };
    } else {
      map = existing;
    }
    const previous = map[currency];
    map[currency] = previous === undefined ? amount : Math.min(previous, amount);
    result[tld] = map;
  }
  return result;
}

async function loadRemoteData(): Promise<[PriceTable, PriceTable, PriceTable, ExchangeRateData[]]> {
  try {
    const [createPrices, renewPrices, transferPrices, rates] = await Promise.all([
      fetchText(UNIFIED_CREATE_PRICES_CSV).then(parseUnifiedPricesCsv),
      fetchText(UNIFIED_RENEW_PRICES_CSV).then(parseUnifiedPricesCsv),
      fetchText(UNIFIED_TRANSFER_PRICES_CSV).then(parseUnifiedPricesCsv),
      fetchJson<ExchangeRateData[]>(EXCHANGE_RATES_JSON_URL),
    ]);
    return [createPrices, renewPrices, transferPrices, rates];
  } catch (error) {
    const err =
      error instanceof Error
        ? error
        : new Error(typeof error === 'string' ? error : 'Unknown error');
    err.message = `domain-quotes: failed to load remote pricing data: ${err.message}`;
    throw err;
  }
}

// Fetch remote datasets once at module load (Node ESM supports top-level await)
const [CREATE_PRICES, RENEW_PRICES, TRANSFER_PRICES, EXCHANGE_RATES] = await loadRemoteData();

function loadPrices(): PriceTable {
  return CREATE_PRICES;
}

function loadRenewPrices(): PriceTable {
  return RENEW_PRICES;
}

function loadTransferPrices(): PriceTable {
  return TRANSFER_PRICES;
}

function loadExchangeRates(): ExchangeRateData[] {
  return EXCHANGE_RATES;
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

function roundAmount(n: number, allowFractional: boolean): number {
  return allowFractional ? round2(n) : Math.round(n);
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
    const allowFractional = options.allowFractionalAmounts ?? false;

    const createMap = toPriceMap(createPrices[ext]);
    if (!createMap) {
      throw new UnsupportedExtensionError(ext);
    }

    let priceMap: Record<string, number> = { ...createMap };
    const transactionTable: PriceTable | undefined = (() => {
      switch (tx) {
        case 'renew':
          return this.config.renewPrices;
        case 'restore':
          return this.config.restorePrices;
        case 'transfer':
          return this.config.transferPrices;
        case 'create':
        default:
          return undefined;
      }
    })();

    if (transactionTable) {
      const override = toPriceMap(transactionTable[ext]);
      if (override) {
        priceMap = { ...priceMap, ...override };
      }
    }

    if (Object.keys(priceMap).length === 0) {
      throw new UnsupportedExtensionError(ext);
    }

    const currency = (currencyCode || '').toUpperCase();
    const supported = this.config.supportedCurrencies ?? ['USD', 'NGN'];
    if (!supported.includes(currency)) {
      throw new UnsupportedCurrencyError(currencyCode);
    }

    const rateInfo = this.findRateInfo(currency);
    const symbol = rateInfo.currencySymbol;
    let baseUsd = priceMap.USD;
    if (baseUsd === undefined) {
      baseUsd = createMap.USD;
    }
    const directCurrencyPrice = priceMap[currency];
    if (baseUsd === undefined && directCurrencyPrice !== undefined) {
      baseUsd = directCurrencyPrice / rateInfo.exchangeRate;
    }
    if (baseUsd === undefined || baseUsd <= 0) {
      throw new UnsupportedExtensionError(ext);
    }
    const markedUsd = applyMarkup(baseUsd, this.config.markup);

    let basePrice: number;
    if (directCurrencyPrice !== undefined && baseUsd > 0) {
      const impliedRate = directCurrencyPrice / baseUsd;
      basePrice = roundAmount(markedUsd * impliedRate, allowFractional);
    } else {
      basePrice = roundAmount(markedUsd * rateInfo.exchangeRate, allowFractional);
    }

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
      const normalizedExtensions = conf.extensions.map(normalizeExtension);
      if (!normalizedExtensions.includes(ext)) continue;
      // Check transaction type if specified
      if (conf.transactions && conf.transactions.length > 0 && !conf.transactions.includes(tx)) continue;
      // Check custom eligibility callback if provided (called only after all other criteria pass)
      if (conf.isEligible) {
        try {
          const context = { extension: ext, currency, transaction: tx, basePrice, discountCode: code };
          const eligible = await Promise.resolve(conf.isEligible(context));
          if (!eligible) continue;
        } catch {
          // If callback throws, skip this discount
          continue;
        }
      }
      applicable.push(roundAmount(basePrice * conf.rate, allowFractional));
    }

    let discount = 0;
    if (applicable.length > 0) {
      if (options.discountPolicy === 'stack') {
        discount = roundAmount(applicable.reduce((a, b) => a + b, 0), allowFractional);
      } else {
        // default: apply only the highest discount
        discount = Math.max(...applicable);
      }
    }
    if (discount > basePrice) discount = basePrice;

    const subtotal = roundAmount(basePrice - discount, allowFractional);
    const tax = roundAmount(subtotal * taxRate, allowFractional);
    const totalPrice = roundAmount(subtotal + tax, allowFractional);

    return { extension: ext, currency, basePrice, discount, tax, totalPrice, symbol, domainTransaction: tx };
  }
}

// Build default config snapshot from the bundled JSON data.
export const DEFAULT_CONFIG: DomainQuoteConfig = {
  createPrices: loadPrices(),
  renewPrices: loadRenewPrices(),
  transferPrices: loadTransferPrices(),
  exchangeRates: loadExchangeRates(),
  vatRate: DEFAULT_VAT_RATE,
  discounts: {},
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
