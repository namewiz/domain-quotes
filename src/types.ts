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

/** Context passed to discount eligibility callbacks */
export interface DiscountEligibilityContext {
  /** The normalized extension (e.g., 'com', 'ng') */
  extension: string;
  /** The currency code (e.g., 'USD', 'NGN') */
  currency: string;
  /** The transaction type */
  transaction: TransactionType;
  /** The base price before discount */
  basePrice: number;
  /** The discount code being evaluated */
  discountCode: string;
}

/** Callback function to determine custom discount eligibility. Return true if eligible, false otherwise. */
export type DiscountEligibilityCallback = (context: DiscountEligibilityContext) => boolean | Promise<boolean>;

export interface DiscountConfig {
  rate: number;
  extensions: string[];
  startAt: string;
  endAt: string;
  /** Optional list of transaction types this discount applies to. If omitted, applies to all transaction types. */
  transactions?: TransactionType[];
  /** Optional callback for custom eligibility logic. Invoked only after all other criteria are satisfied. */
  isEligible?: DiscountEligibilityCallback;
}

export type DiscountPolicy = 'stack' | 'max';
export type TransactionType = 'create' | 'renew' | 'restore' | 'transfer';

export interface GetQuoteOptions {
  discountCodes?: string[];
  now?: number | Date;
  discountPolicy?: DiscountPolicy;
  transaction?: TransactionType; // default: 'create'
  /** When true, amounts retain 2 decimal places (cents/kobos). When false (default), amounts are rounded to nearest integer. */
  allowFractionalAmounts?: boolean;
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
