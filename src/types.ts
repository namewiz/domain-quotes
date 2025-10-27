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

export type VatRates = Record<string, number>;

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

