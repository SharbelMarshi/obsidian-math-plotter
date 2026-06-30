import type { App } from 'obsidian';

export interface GraphThemeColors {
	isDark: boolean;
	foreground: string;
	axis: string;
	grid: string;
	text: string;
	defaultLine: string;
	defaultWireframe: string;
}

const LIGHT_FALLBACKS = {
	foreground: '#111111',
	axis: '#111111',
	text: '#111111',
	grid: '#d0d0d0',
	defaultLine: '#111111',
	defaultWireframe: '#111111',
};

const DARK_FALLBACKS = {
	foreground: '#f2f2f2',
	axis: '#f2f2f2',
	text: '#f2f2f2',
	grid: '#3a3a3a',
	defaultLine: '#f2f2f2',
	defaultWireframe: '#f2f2f2',
};

function isDocument(value: unknown): value is Document {
	return typeof value === 'object' && value !== null && 'body' in value;
}

export function isObsidianDarkTheme(doc?: Document): boolean {
	const activeDoc = doc ?? (typeof activeDocument !== 'undefined' ? activeDocument : undefined);
	if (!activeDoc) {
		return false;
	}
	return activeDoc.body.classList.contains('theme-dark');
}

function readCssColor(varName: string, fallback: string, doc: Document): string {
	try {
		const raw = getComputedStyle(doc.body).getPropertyValue(varName).trim();
		return raw || fallback;
	} catch {
		return fallback;
	}
}

export function resolveGraphThemeColors(app?: App | Document): GraphThemeColors {
	let doc: Document | undefined;
	if (isDocument(app)) {
		doc = app;
	} else if (typeof activeDocument !== 'undefined') {
		doc = activeDocument;
	}

	if (!doc) {
		return {
			isDark: false,
			...LIGHT_FALLBACKS,
		};
	}

	const isDark = isObsidianDarkTheme(doc);
	const fallbacks = isDark ? DARK_FALLBACKS : LIGHT_FALLBACKS;

	const foreground = readCssColor('--text-normal', fallbacks.foreground, doc);
	const text = readCssColor('--text-muted', fallbacks.text, doc);
	const grid = readCssColor('--background-modifier-border', fallbacks.grid, doc);

	return {
		isDark,
		foreground,
		axis: foreground,
		grid,
		text,
		defaultLine: foreground,
		defaultWireframe: foreground,
	};
}

/** Convert a CSS color string to uppercase 6-digit hex for TikZ HTML colors. */
export function cssColorToTikzHtml(color: string): string {
	const trimmed = color.trim();
	if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
		return trimmed.slice(1).toUpperCase();
	}
	if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
		const shortHex = trimmed.match(/^#(.)(.)(.)$/i);
		if (shortHex) {
			const [, r, g, b] = shortHex;
			return `${r}${r}${g}${g}${b}${b}`.toUpperCase();
		}
	}

	const rgbMatch = trimmed.match(/^rgba?\(\s*([\d.]+)(?:%|)\s*,\s*([\d.]+)(?:%|)\s*,\s*([\d.]+)(?:%|)/i);
	if (rgbMatch) {
		const toByte = (value: string, isPercent: boolean): number => {
			const n = Number.parseFloat(value);
			if (isPercent || trimmed.includes('%')) {
				return Math.round(Math.min(100, Math.max(0, n)) * 2.55);
			}
			return Math.round(Math.min(255, Math.max(0, n)));
		};
		const isPercent = trimmed.includes('%');
		const r = toByte(rgbMatch[1], isPercent).toString(16).padStart(2, '0');
		const g = toByte(rgbMatch[2], isPercent).toString(16).padStart(2, '0');
		const b = toByte(rgbMatch[3], isPercent).toString(16).padStart(2, '0');
		return `${r}${g}${b}`.toUpperCase();
	}

	return (isObsidianDarkTheme() ? DARK_FALLBACKS.foreground : LIGHT_FALLBACKS.foreground)
		.slice(1)
		.toUpperCase();
}

export function buildTikzThemeColorDefinitions(theme: GraphThemeColors): string {
	const axis = cssColorToTikzHtml(theme.axis);
	const grid = cssColorToTikzHtml(theme.grid);
	const line = cssColorToTikzHtml(theme.defaultLine);
	return [
		'\\definecolor{mathgraphAxis}{HTML}{' + axis + '}',
		'\\definecolor{mathgraphGrid}{HTML}{' + grid + '}',
		'\\definecolor{mathgraphLine}{HTML}{' + line + '}',
	].join('\n');
}

export function themeCacheSegment(isDark: boolean): 'dark' | 'light' {
	return isDark ? 'dark' : 'light';
}

export type ThemeName = 'light' | 'dark';

export function getCurrentTheme(doc?: Document): ThemeName {
	if (doc) {
		return isObsidianDarkTheme(doc) ? 'dark' : 'light';
	}
	if (typeof activeDocument !== 'undefined') {
		return isObsidianDarkTheme(activeDocument) ? 'dark' : 'light';
	}
	return 'light';
}
