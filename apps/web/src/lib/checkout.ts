/**
 * Grosslytics' own Dodo Payments checkout links. A build can point elsewhere with PUBLIC_CHECKOUT_LIFETIME_URL / PUBLIC_CHECKOUT_CLOUD_URL.
 * Dodo sends the buyer back to `redirect_url`, adding payment_id, status and email.
 */
export const CHECKOUT_LIFETIME: string =
	import.meta.env?.PUBLIC_CHECKOUT_LIFETIME_URL || 'https://checkout.dodopayments.com/buy/pdt_0NrRPjE8ZMtW2BNM0a6bm?quantity=1&redirect_url=https://grosslytics.com%2Flicense';
export const CHECKOUT_CLOUD: string =
	import.meta.env?.PUBLIC_CHECKOUT_CLOUD_URL || 'https://checkout.dodopayments.com/buy/pdt_0NrRQDwasogpEvsc1LfyF?quantity=1&redirect_url=https://grosslytics.com%2Fapp';

/** Indie Cloud's monthly price, as shown everywhere on the site */
export const CLOUD_PRICE = '$5.99';
