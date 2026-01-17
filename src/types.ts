export interface Quote {
  extension: string;
  currency: string;
  basePrice: number;
  discount: number;
  tax: number;
  totalPrice: number;
  symbol: string;
  domainTransaction: TransactionType;
}

export type MarkupType = 'percentage' | 'fixedUsd';

export interface Markup {
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

export interface DiscountConfig {
  rate: number;
  extensions: string[];
  startAt: string;
  endAt: string;
}

export type DiscountPolicy = 'stack' | 'max';
export type TransactionType = 'create' | 'renew' | 'restore' | 'transfer';

export interface GetQuoteOptions {
  discountCodes?: string[];
  now?: number | Date;
  discountPolicy?: DiscountPolicy;
  transaction?: TransactionType; // default: 'create'
}

export type PriceEntry = number | Record<string, number>;
export type PriceTable = Record<string, PriceEntry>;

export interface DomainQuoteConfig {
  createPrices: PriceTable;
  // Optional alternative price tables by transaction type (USD/default currency). Falls back to `createPrices` when not provided.
  renewPrices?: PriceTable;
  restorePrices?: PriceTable;
  transferPrices?: PriceTable;
  exchangeRates: ExchangeRateData[];
  // Single VAT rate applied across all countries/currencies.
  vatRate: number;
  discounts: Record<string, DiscountConfig>;
  markup?: Markup;
  // Uppercase ISO 4217 currency codes allowed. Defaults to ['USD', 'NGN'].
  supportedCurrencies?: string[];
}
