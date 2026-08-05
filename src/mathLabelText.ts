/**
 * Label formatting for graph titles and axis labels.
 *
 * - formatLatexLabel: prepares user text for pgfplots (wraps math-looking text in $…$
 *   so LaTeX compiles instead of erroring on ^ or \ in text mode).
 * - formatMathLabelText: best-effort Unicode rendering of LaTeX math for the fast
 *   SVG preview, e.g. $e^{-y}\sin(x)$ → e⁻ʸ sin(x).
 */

const SUPERSCRIPTS: Record<string, string> = {
	'0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
	'5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
	'+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
	'a': 'ᵃ', 'b': 'ᵇ', 'c': 'ᶜ', 'd': 'ᵈ', 'e': 'ᵉ', 'f': 'ᶠ', 'g': 'ᵍ',
	'h': 'ʰ', 'i': 'ⁱ', 'j': 'ʲ', 'k': 'ᵏ', 'l': 'ˡ', 'm': 'ᵐ', 'n': 'ⁿ',
	'o': 'ᵒ', 'p': 'ᵖ', 'r': 'ʳ', 's': 'ˢ', 't': 'ᵗ', 'u': 'ᵘ', 'v': 'ᵛ',
	'w': 'ʷ', 'x': 'ˣ', 'y': 'ʸ', 'z': 'ᶻ',
};

const SUBSCRIPTS: Record<string, string> = {
	'0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
	'5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
	'+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎',
	'a': 'ₐ', 'e': 'ₑ', 'h': 'ₕ', 'i': 'ᵢ', 'j': 'ⱼ', 'k': 'ₖ', 'l': 'ₗ',
	'm': 'ₘ', 'n': 'ₙ', 'o': 'ₒ', 'p': 'ₚ', 'r': 'ᵣ', 's': 'ₛ', 't': 'ₜ',
	'u': 'ᵤ', 'v': 'ᵥ', 'x': 'ₓ',
};

const GREEK_GLYPHS: Record<string, string> = {
	alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
	zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
	lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', rho: 'ρ', sigma: 'σ', tau: 'τ',
	upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
	Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
	Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', pi: 'π',
};

const SYMBOL_COMMANDS: Record<string, string> = {
	cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', infty: '∞',
	to: '→', rightarrow: '→', leftarrow: '←', partial: '∂', nabla: '∇',
	le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈',
	sqrt: '√', sum: '∑', prod: '∏', int: '∫', pm0: '±',
};

function mapScript(content: string, table: Record<string, string>): string | null {
	let out = '';
	for (const char of content) {
		const mapped = table[char];
		if (mapped === undefined) {
			return null;
		}
		out += mapped;
	}
	return out;
}

function convertScripts(text: string, marker: '^' | '_', table: Record<string, string>): string {
	const escapedMarker = marker === '^' ? '\\^' : '_';
	const braced = new RegExp(`${escapedMarker}\\{([^{}]*)\\}`, 'g');
	const single = new RegExp(`${escapedMarker}([A-Za-z0-9])`, 'g');

	let result = text.replace(braced, (match, content: string) => {
		const mapped = mapScript(content, table);
		return mapped ?? `${marker}(${content})`;
	});
	result = result.replace(single, (match, char: string) => {
		const mapped = mapScript(char, table);
		return mapped ?? match;
	});
	return result;
}

/** Best-effort Unicode rendering of LaTeX-ish math for SVG text labels. */
export function formatMathLabelText(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) {
		return '';
	}
	// Mixed text and math: convert each $…$ segment, leave surrounding text as-is.
	if (trimmed.includes('$')) {
		return trimmed.replace(/\$\$?([^$]*)\$\$?/g, (_match, inner: string) => convertMathSegment(inner)).trim();
	}
	return convertMathSegment(trimmed);
}

function convertMathSegment(raw: string): string {
	let text = raw.trim();
	if (!text) {
		return '';
	}

	text = text
		.replace(/\\\(|\\\)|\\\[|\\\]/g, '')
		.replace(/\\left\b/g, '')
		.replace(/\\right\b/g, '')
		.replace(/\\[,;!:]/g, ' ')
		.replace(/\\mathrm\s*\{([^{}]*)\}/g, '$1')
		.replace(/\\text\s*\{([^{}]*)\}/g, '$1')
		.replace(/\\operatorname\s*\{([^{}]*)\}/g, '$1');

	// \frac{a}{b} → a/b (parenthesized when the parts are compound)
	for (let guard = 0; guard < 16; guard++) {
		const next = text.replace(
			/\\[dtc]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/,
			(match, a: string, b: string) => {
				const num = /^[A-Za-z0-9.]+$/.test(a) ? a : `(${a})`;
				const den = /^[A-Za-z0-9.]+$/.test(b) ? b : `(${b})`;
				return `${num}/${den}`;
			},
		);
		if (next === text) {
			break;
		}
		text = next;
	}

	// (?![A-Za-z]) instead of \b — command names end at any non-letter, including _ and digits.
	for (const [name, glyph] of Object.entries(SYMBOL_COMMANDS)) {
		text = text.replace(new RegExp(`\\\\${name}(?![A-Za-z])`, 'g'), glyph);
	}

	const greekNames = Object.keys(GREEK_GLYPHS).sort((a, b) => b.length - a.length);
	for (const name of greekNames) {
		text = text.replace(new RegExp(`\\\\${name}(?![A-Za-z])`, 'g'), GREEK_GLYPHS[name]);
	}

	// Remaining commands (\sin, \exp, …) become plain words.
	text = text.replace(/\\([A-Za-z]+)/g, '$1');

	text = convertScripts(text, '^', SUPERSCRIPTS);
	text = convertScripts(text, '_', SUBSCRIPTS);

	return text.replace(/[{}]/g, '').trim();
}

/** Prepare user title/label text for pgfplots — wrap math-looking text in $…$. */
export function formatLatexLabel(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) {
		return '';
	}
	if (trimmed.includes('$')) {
		return trimmed;
	}
	if (/[\\^_]/.test(trimmed)) {
		return `$${trimmed}$`;
	}
	return trimmed;
}
