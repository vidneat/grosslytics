/**
 * Copies text, and never fails silently. navigator.clipboard is refused in some browsers (in-app and embedded browsers,
 * strict permission settings), so this falls back to the older copy command, then to a prompt with the text selected.
 * Returns true when the text reached the clipboard.
 */
export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {}
	const ta = document.createElement('textarea');
	ta.value = text;
	ta.setAttribute('readonly', '');
	ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
	document.body.appendChild(ta);
	ta.select();
	let ok = false;
	try {
		ok = document.execCommand('copy');
	} catch {}
	ta.remove();
	if (!ok) window.prompt('Copy this (Ctrl+C or ⌘C):', text);
	return ok;
}
