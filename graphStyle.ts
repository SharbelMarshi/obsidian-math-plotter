const NAMED_COLORS: Record<string, string> = {
	red: 'red',
	blue: 'blue',
	green: 'green!60!black',
	orange: 'orange',
	purple: 'violet',
	yellow: 'yellow!80!black',
	cyan: 'cyan',
	magenta: 'magenta',
	black: 'black',
	gray: 'gray',
	grey: 'gray',
};

export interface ParsedPlotStyle {
	cleanedOptions: string;
	extraPlotOpts: string[];
	legendLabel?: string;
	fillMode?: 'under' | 'between';
	fillOpacity?: number;
	namePath?: string;
}

function stripOption(options: string, name: string): string {
	return options
		.replace(new RegExp(`(?:^|,\\s*)${name}(?:\\s*=\\s*[^,]+)?`, 'g'), '')
		.replace(/^,\s*/, '')
		.replace(/,\s*$/, '')
		.trim();
}

function extractOptionValue(options: string, name: string): string | null {
	const match = options.match(new RegExp(`(?:^|,\\s*)${name}\\s*=\\s*([^,]+)`));
	return match?.[1]?.trim() ?? null;
}

function hasOptionValue(options: string, name: string): boolean {
	return new RegExp(`(?:^|,\\s*)${name}\\s*=`).test(options);
}

function mapColor(value: string): string {
	const trimmed = value.trim();
	if (NAMED_COLORS[trimmed.toLowerCase()]) {
		return NAMED_COLORS[trimmed.toLowerCase()];
	}
	if (/^#?[0-9a-f]{6}$/i.test(trimmed)) {
		const hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
		const r = Number.parseInt(hex.slice(0, 2), 16);
		const g = Number.parseInt(hex.slice(2, 4), 16);
		const b = Number.parseInt(hex.slice(4, 6), 16);
		return `{rgb,255:red,${r}; green,${g}; blue,${b}}`;
	}
	return trimmed;
}

export function applyPlotStyleOptions(options: string, plotIndex: number): ParsedPlotStyle {
	let cleaned = options.trim();
	const extraPlotOpts: string[] = [];
	let legendLabel: string | undefined;
	let fillMode: 'under' | 'between' | undefined;
	let fillOpacity: number | undefined;

	const label = extractOptionValue(cleaned, 'label');
	if (label) {
		legendLabel = label.replace(/^\{|\}$/g, '').trim();
		cleaned = stripOption(cleaned, 'label');
	}

	if (hasOptionValue(cleaned, 'legend') || label) {
		cleaned = stripOption(cleaned, 'legend');
	}

	const color = extractOptionValue(cleaned, 'color');
	if (color) {
		extraPlotOpts.push(mapColor(color));
		cleaned = stripOption(cleaned, 'color');
	}

	const style = extractOptionValue(cleaned, 'style');
	if (style) {
		for (const token of style.split('|').map(part => part.trim()).filter(Boolean)) {
			extraPlotOpts.push(token);
		}
		cleaned = stripOption(cleaned, 'style');
	}

	const width = extractOptionValue(cleaned, 'width');
	if (width) {
		extraPlotOpts.push(width);
		cleaned = stripOption(cleaned, 'width');
	}

	const opacity = extractOptionValue(cleaned, 'opacity');
	if (opacity) {
		const value = Number.parseFloat(opacity);
		if (Number.isFinite(value)) {
			fillOpacity = value;
			extraPlotOpts.push(`opacity=${value}`);
		}
		cleaned = stripOption(cleaned, 'opacity');
	}

	const fill = extractOptionValue(cleaned, 'fill');
	if (fill === 'under') {
		fillMode = 'under';
		cleaned = stripOption(cleaned, 'fill');
	} else if (fill === 'between') {
		fillMode = 'between';
		cleaned = stripOption(cleaned, 'fill');
	}

	return {
		cleanedOptions: cleaned,
		extraPlotOpts,
		legendLabel,
		fillMode,
		fillOpacity,
		namePath: `plot${plotIndex}`,
	};
}

export function buildFillBetweenLine(
	pathA: string,
	pathB: string,
	colorOpt: string,
	opacity = 0.15,
): string {
	const colorPart = colorOpt ? `${colorOpt}, ` : '';
	return `\\addplot[${colorPart}fill opacity=${opacity}, draw=none] fill between[of=${pathA} and ${pathB}];`;
}

export function buildFilledCycleLine(domain: string, expr: string, colorOpt: string, opacity = 0.2): string {
	const colorPart = colorOpt ? `${colorOpt}, ` : '';
	return `\\addplot[${colorPart}fill opacity=${opacity}, draw=none, domain=${domain}] {${expr}} \\closedcycle;`;
}
