import { test, expect } from 'bun:test';
import * as v from 'valibot';
import {
	calculateGatewayFee,
	calculateNetRevenue,
	maskEmail,
} from './fees.js';
import {
	timeToConvertHours,
	classifySourceCategory,
	toHourBucket,
} from './attribution.js';
import { BeaconSchema } from './schemas.js';

test('fees: calculates Stripe and Razorpay accurately', () => {
	// Stripe: 2.9% + 30¢ ($100 = 10000 cents -> 290 + 30 = 320 cents fee)
	const stripeRev = calculateNetRevenue('stripe', 10000);
	expect(stripeRev.feeCents).toBe(320);
	expect(stripeRev.netCents).toBe(9680);

	// Razorpay: 2.0% + 0¢ ($50 = 5000 cents -> 100 cents fee)
	const rzpFee = calculateGatewayFee('razorpay', 5000);
	expect(rzpFee).toBe(100);

	// Email masking
	expect(maskEmail('alex@grosslytics.com')).toBe('a***@grosslytics.com');
});

test('attribution: time to convert and hour buckets', () => {
	// Time to convert in hours
	expect(timeToConvertHours(1700000000, 1700007200)).toBe(2);

	// Hourly bucket truncation (3600s)
	expect(toHourBucket(1700003500)).toBe(1700002800);
});

test('attribution: unmasking source categories', () => {
	expect(classifySourceCategory('chatgpt.com (AI)')).toBe('AI Search');
	expect(classifySourceCategory('instagram.com (in-app)')).toBe('Social (Organic)');
	expect(classifySourceCategory('google.com')).toBe('Organic Search');
	expect(classifySourceCategory('Direct (Shared Link)')).toBe('Direct');
});

test('schema: validates edge beacon payload', () => {
	const validBeacon = {
		sid: 'gl_live_test',
		vid: 'vid_12345',
		ses: 'ses_12345',
		t: 'pageview',
		n: '/pricing',
		src: 'x.com (in-app)',
		cat: 'Social (Organic)',
		ref: 'https://t.co/xyz',
		sd: 85,
		dur: 42,
		us: 'twitter',
		um: 'social',
		uc: 'launch',
	};

	const res = v.safeParse(BeaconSchema, validBeacon);
	expect(res.success).toBe(true);

	// Invalid event type should fail
	const invalid = { ...validBeacon, t: 'invalid_event' };
	expect(v.safeParse(BeaconSchema, invalid).success).toBe(false);
});
