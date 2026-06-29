/** TeX math minus glyphs that break when Computer Modern fonts are unavailable (e.g. SVG in <img>). */
const TEX_MINUS_GLYPHS = new Set(['-', '−', '\u2212', '¡', '\u00a1']);

function readTextAttr(attrs: string, name: string): string | undefined {
	const match = attrs.match(new RegExp(`\\b${name}="([^"]+)"`));
	return match?.[1];
}

function isTexMinusGlyph(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) {
		return false;
	}
	if (TEX_MINUS_GLYPHS.has(trimmed)) {
		return true;
	}
	return trimmed.length === 1 && !/[0-9a-zA-Z.]/.test(trimmed);
}

interface ParsedTextNode {
	family: string;
	content: string;
	attrs: string;
}

function parseTextNodes(inner: string): ParsedTextNode[] {
	const nodes: ParsedTextNode[] = [];
	const re = /<text\b([^>]*)>([^<]*)<\/text>/g;
	for (const match of inner.matchAll(re)) {
		const attrs = match[1];
		const family = attrs.match(/font-family="([^"]+)"/)?.[1] ?? '';
		nodes.push({ family, content: match[2], attrs });
	}
	return nodes;
}

function mergeMinusTickLabel(nodes: ParsedTextNode[]): string | null {
	if (nodes.length < 2 || nodes[0].family !== 'cmsy10' || !isTexMinusGlyph(nodes[0].content)) {
		return null;
	}

	const digitNodes = nodes.slice(1).filter(node => node.family === 'cmr10');
	if (digitNodes.length === 0) {
		return null;
	}

	const digits = digitNodes.map(node => node.content).join('');
	if (!/^[\d.]+$/.test(digits)) {
		return null;
	}

	const ref = digitNodes[0];
	const x = readTextAttr(ref.attrs, 'x') ?? '0';
	const y = readTextAttr(ref.attrs, 'y') ?? '0';
	const transform = readTextAttr(ref.attrs, 'transform');
	const transformAttr = transform ? ` transform="${transform}"` : '';
	return `<text x="${x}" y="${y}" stroke="none" font-family="sans-serif" font-size="10"${transformAttr}>-${digits}</text>`;
}

function fixTickLabelGroup(inner: string): string | null {
	return mergeMinusTickLabel(parseTextNodes(inner));
}

function fixAdjacentMinusTexts(svg: string): string {
	return svg.replace(
		/<text([^>]*)font-family="cmsy10"([^>]*)>([^<]*)<\/text>\s*<text([^>]*)font-family="cmr10"([^>]*)>([^<]*)<\/text>/g,
		(full, a1, b1, minusText, a2, b2, digitText) => {
			if (!isTexMinusGlyph(minusText)) {
				return full;
			}
			if (!/^[\d.]+$/.test(digitText)) {
				return full;
			}
			const attrs = a2 + b2;
			const x = readTextAttr(attrs, 'x') ?? '0';
			const y = readTextAttr(attrs, 'y') ?? '0';
			const transform = readTextAttr(attrs, 'transform');
			const transformAttr = transform ? ` transform="${transform}"` : '';
			return `<text x="${x}" y="${y}" stroke="none" font-family="sans-serif" font-size="10"${transformAttr}>-${digitText}</text>`;
		},
	);
}

function normalizeUnicodeMinusInText(svg: string): string {
	return svg.replace(/(<text\b[^>]*>)([^<]*)(<\/text>)/g, (full, open, content, close) => {
		if (!content.includes('\u2212') && !content.includes('−')) {
			return full;
		}
		return `${open}${content.replace(/\u2212/g, '-').replace(/−/g, '-')}${close}`;
	});
}

/** Repair TikZJax/PGFPlots tick labels that split minus into unavailable TeX fonts. */
export function fixTikzJaxSvgTickLabels(svg: string): string {
	let result = svg.replace(
		/<g\b([^>]*\bstroke="none"[^>]*)>([\s\S]*?)<\/g>/g,
		(full, _gAttrs, inner) => {
			if (!inner.includes('font-family="cmsy10"')) {
				return full;
			}
			const fixed = fixTickLabelGroup(inner);
			return fixed ?? full;
		},
	);

	result = fixAdjacentMinusTexts(result);
	result = normalizeUnicodeMinusInText(result);
	return result;
}
