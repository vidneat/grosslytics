import type { PaymentGateway } from './types.js';

/**
 * Payment gateway fee structures.
 * Used to automatically calculate net revenue from gross payments.
 *
 * Fees are defined as: fixedCents + (grossAmountCents * percentBps / 10000)
 *
 * Sources:
 * - Stripe: 2.9% + 30¢ (US domestic cards)
 * - Razorpay: 2.0% + 0¢ (India domestic)
 * - Polar: 5.0% + 0¢ (platform fee only)
 * - Paddle: 5.0% + 50¢ (includes tax remittance)
 * - LemonSqueezy: 5.0% + 50¢ (includes tax remittance)
 */
const GATEWAY_FEES: Record<PaymentGateway, { fixedCents: number; percentBps: number }> = {
	stripe: { fixedCents: 30, percentBps: 290 },
	razorpay: { fixedCents: 0, percentBps: 200 },
	polar: { fixedCents: 0, percentBps: 500 },
	paddle: { fixedCents: 50, percentBps: 500 },
	lemonsqueezy: { fixedCents: 50, percentBps: 500 },
};

/**
 * Calculates the estimated gateway fee for a payment.
 *
 * @param gateway - Payment gateway identifier
 * @param grossAmountCents - Gross payment amount in cents
 * @returns Estimated fee in cents
 */
export function calculateGatewayFee(gateway: PaymentGateway, grossAmountCents: number): number {
	const feeStructure = GATEWAY_FEES[gateway];
	return Math.round(feeStructure.fixedCents + (grossAmountCents * feeStructure.percentBps) / 10000);
}

/**
 * Calculates net revenue after gateway fees.
 *
 * @param gateway - Payment gateway identifier
 * @param grossAmountCents - Gross payment amount in cents
 * @returns Object with gross, fee, and net amounts in cents
 */
export function calculateNetRevenue(
	gateway: PaymentGateway,
	grossAmountCents: number,
): { grossCents: number; feeCents: number; netCents: number } {
	const feeCents = calculateGatewayFee(gateway, grossAmountCents);
	return {
		grossCents: grossAmountCents,
		feeCents,
		netCents: grossAmountCents - feeCents,
	};
}

/**
 * Masks an email for privacy display (e.g., "r***@gmail.com")
 */
export function maskEmail(email: string): string {
	const [local, domain] = email.split('@');
	if (!local || !domain) return '***@***';
	return `${local[0]}***@${domain}`;
}

