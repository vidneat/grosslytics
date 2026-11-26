const publicHostname = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const specialUse = /\.(?:localhost|local|internal|onion|test|invalid|home|arpa|example)$/;
export const isDnsHostname = (host: string) => publicHostname.test(host);

export function isPublicHostname(host: string): boolean {
	return isDnsHostname(host) && !specialUse.test(host);
}

export async function dnsAnswers(name: string, type: 'A' | 'AAAA' | 'TXT'): Promise<string[]> {
	const params = new URLSearchParams({ name, type });
	const response = await fetch(`https://cloudflare-dns.com/dns-query?${params}`, {
		headers: { accept: 'application/dns-json' },
		// Workers support manual redirects here. The non-2xx check below rejects them.
		redirect: 'manual',
		signal: AbortSignal.timeout(4000),
	});
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error('DNS lookup failed');
	}
	const result = await response.json<{ Status: number; Answer?: { type: number; data: string }[] }>();
	if (result.Status === 3) return [];
	if (result.Status !== 0) throw new Error('DNS lookup failed');
	const recordType = { A: 1, AAAA: 28, TXT: 16 }[type];
	return (result.Answer ?? []).filter((row) => row.type === recordType).map((row) => row.data);
}

function publicAddress(address: string): boolean {
	if (address.includes(':')) return /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:(?:0|db8):/i.test(address) && !/^2002:/i.test(address);
	const [a, b, c] = address.split('.').map(Number);
	if (a === undefined || b === undefined || c === undefined) return false;
	return a > 0 && a < 224 && ![10, 127].includes(a)
		&& !(a === 100 && b >= 64 && b <= 127)
		&& !(a === 169 && b === 254)
		&& !(a === 172 && b >= 16 && b <= 31)
		&& !(a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99)))
		&& !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
		&& !(a === 203 && b === 0 && c === 113);
}

export async function resolvesPublicly(host: string): Promise<boolean> {
	if (!isPublicHostname(host)) return false;
	const addresses = (await Promise.all([dnsAnswers(host, 'A'), dnsAnswers(host, 'AAAA')])).flat();
	return addresses.length > 0 && addresses.every(publicAddress);
}
