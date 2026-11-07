/** One reporting currency per site. These supported currencies all use 100 minor units. */
export const REPORTING_CURRENCIES = ['USD', 'EUR', 'GBP', 'INR'] as const;

export function reportingCurrency(value = 'USD'): string {
	const currency = value.toUpperCase();
	if (!REPORTING_CURRENCIES.some((code) => code === currency))
		throw new Error(`Unsupported reporting currency: ${currency}. Use USD, EUR, GBP or INR.`);
	return currency;
}

export const formatMoney = (amount: number, currency: string, digits = 0): string =>
	(amount / 100).toLocaleString('en-US', {
		style: 'currency',
		currency: reportingCurrency(currency),
		maximumFractionDigits: digits,
		minimumFractionDigits: digits,
	});
