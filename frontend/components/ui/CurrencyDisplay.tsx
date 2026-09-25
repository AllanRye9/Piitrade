import { formatCurrency, convertCurrency } from '@/lib/utils';
import { Currency } from '@/lib/types';

// Short suffix shown after the price for listings priced by weight rather
// than per item (Agriculture produce — see Listing.priceUnit). 'ITEM' (the
// default) and unset both render no suffix, since "per item" is implied.
const UNIT_SUFFIX: Record<'ITEM' | 'KG' | 'TONNE', string | null> = {
  ITEM: null,
  KG: '/ kg',
  TONNE: '/ tonne',
};

interface Props {
  amount: number;
  currency: Currency;
  /** When provided, converts and shows the price in this currency instead */
  displayCurrency?: Currency;
  className?: string;
  /** Show the original currency label in smaller text when conversion is active */
  showOriginal?: boolean;
  /** Listing.priceUnit — appends "/ kg" or "/ tonne" after the amount. */
  unit?: 'ITEM' | 'KG' | 'TONNE';
}

export function CurrencyDisplay({
  amount,
  currency,
  displayCurrency,
  className = '',
  showOriginal = false,
  unit,
}: Props) {
  const unitSuffix = unit ? UNIT_SUFFIX[unit] : null;
  const unitLabel = unitSuffix && (
    <span className="ml-0.5 text-[0.65em] font-semibold opacity-70">{unitSuffix}</span>
  );

  if (!displayCurrency || displayCurrency === currency) {
    return <span className={className}>{formatCurrency(amount, currency)}{unitLabel}</span>;
  }

  const converted = convertCurrency(amount, currency, displayCurrency);
  return (
    <span className={className}>
      {formatCurrency(converted, displayCurrency)}
      {unitLabel}
      {showOriginal && (
        <span className="ml-1 text-[0.7em] opacity-60 font-normal">
          ≈ {formatCurrency(amount, currency)}
        </span>
      )}
    </span>
  );
}
