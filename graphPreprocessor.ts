import {
	buildParameterDefs,
	estimateExplicitYRange,
	estimateParametricCartesianRange,
	estimatePolarCartesianRange,
	extractGraphParameters,
	findBracedArgument,
	GraphSyntaxError,
	isLikelyDegreeDomain,
	normalizeFunctionExpression,
	parseInequality,
	resolvePlotMode,
	splitAxisArgList,
	substituteParameters,
	type GraphParameter,
	type NumericRange,
	type PlotMode,
} from './graphExpression';
import {
	findIntersectionNumeric,
	findRootsNumeric,
	formatAnalysisCoordinates,
	parseIntersectExpressions,
	parseRootExpression,
} from './graphAnalysis';
import { tryImplicitFallback, tryInequalityCircleFill } from './graphImplicit';
import {
	extractOdeInitialConditions,
	formatOdeCoordinates,
	hasOdeSolutionFlag,
	parseOdeExpression,
	solveFirstOrderOde,
	solveSecondOrderOde,
} from './graphOde';
import {
	GraphExpressionSyntaxError,
	compileExpressionForPgfplots,
	graphParametersToRecord,
} from './graphSyntax';
import {
	applyPlotStyleOptions,
	buildFillBetweenLine,
	buildFilledCycleLine,
} from './graphStyle';

export { GraphSyntaxError } from './graphExpression';

import { pgfplots3dAxisCoreOptions, pgfplotsThemeAxisStyleOptions } from './src/pgfplots3dAxisStyle';
import { pgfplotsTextSafeTickOptions } from './src/pgfplotsTickStyle';
const DEFAULT_AXIS_WIDTH = '6cm';
const DEFAULT_AXIS_HEIGHT = '4cm';

const DEFAULT_PLOT_COLOR = 'mathgraphLine';

const DEFAULT_AXIS_OPTIONS = [
	'grid=both',
	'axis lines=middle',
	pgfplotsThemeAxisStyleOptions(),
	pgfplotsTextSafeTickOptions(),
].join(', ');

const NUMERIC_RANGE_PATTERN = /^(-?\d+(?:\.\d+)?)\s*:\s*(-?\d+(?:\.\d+)?)$/;
const SIZE_UNIT_PATTERN = /^(?:\d+(?:\.\d+)?|\.\d+)(cm|mm|in|pt|ex|em)$/i;

interface ParsedBrackets {
	content: string;
	end: number;
}

interface ParsedBraces {
	content: string;
	end: number;
}

interface AxisLimits {
	x?: NumericRange;
	y?: NumericRange;
	explicitX: boolean;
	explicitY: boolean;
}

interface ParsedAxisBraces {
	kind: 'size' | 'range' | 'kv' | 'combined';
	width: string;
	height: string;
	xRange?: NumericRange;
	yRange?: NumericRange;
	kvOptions?: string;
}

interface ParsedAxisCommand {
	bracketOpts: string;
	sizeArg: string;
	remaining: string;
}

interface PlotConversion {
	line: string;
	limits: AxisLimits;
	requiresEqualAspect?: boolean;
	isSurface3d?: boolean;
	legendLabel?: string;
	needsFillBetween?: boolean;
	namePath?: string;
}

interface GraphCommandMatch {
	kind: 'function' | 'point' | 'points' | 'line' | 'shade' | 'roots' | 'intersect';
	start: number;
	end: number;
}

function appendLegend(lines: string[], legendLabel?: string): void {
	if (legendLabel) {
		lines.push(`\\addlegendentry{${legendLabel}}`);
	}
}

interface ReplaceGraphCommandsResult {
	plotBody: string;
	limits: AxisLimits;
	equalAspect: boolean;
	hasSurface3d: boolean;
	hasCartesian2d: boolean;
	plotCount: number;
	needsFillBetween: boolean;
}

function graphSyntaxError(message: string, hint?: string, line?: number): GraphSyntaxError {
	return new GraphSyntaxError(message, hint, line);
}

function normalizePlotExpression(raw: string, parameters: GraphParameter[] = []): string {
	try {
		return compileExpressionForPgfplots(raw, {
			variables: ['x', 'y', 'z', 't', 'r'],
			parameters: graphParametersToRecord(parameters),
		});
	} catch (err) {
		if (err instanceof GraphExpressionSyntaxError) {
			throw graphSyntaxError(err.message);
		}
		throw err;
	}
}

function lineNumberAt(text: string, index: number, baseLine = 1): number {
	return baseLine + text.slice(0, index).split('\n').length - 1;
}

function findNextGraphCommand(text: string, start: number): GraphCommandMatch | null {
	const pattern = /\\(function|points|point|line|shade|roots|intersect)\b/g;
	pattern.lastIndex = start;
	const match = pattern.exec(text);
	if (!match || match.index === undefined) {
		return null;
	}

	return {
		kind: match[1] as GraphCommandMatch['kind'],
		start: match.index,
		end: match.index,
	};
}

function parseCoordinatePair(content: string): { x: string; y: string } | null {
	const trimmed = content.trim().replace(/^\(\s*|\s*\)$/g, '').trim();
	if (!trimmed) {
		return null;
	}

	if (trimmed.includes(',')) {
		const [x, y] = trimmed.split(',').map(part => part.trim());
		if (x && y) {
			return { x, y };
		}
	}

	if (trimmed.includes(';')) {
		const [x, y] = trimmed.split(';').map(part => part.trim());
		if (x && y) {
			return { x, y };
		}
	}

	return null;
}

function parseNumericLiteral(value: string): number | null {
	const trimmed = value.trim();
	if (!/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(trimmed)) {
		return null;
	}
	const parsed = Number.parseFloat(trimmed);
	return Number.isFinite(parsed) ? parsed : null;
}

function limitsFromCoordinatePair(xExpr: string, yExpr: string): AxisLimits {
	const limits = emptyAxisLimits();
	const x = parseNumericLiteral(xExpr);
	const y = parseNumericLiteral(yExpr);
	if (x !== null) {
		limits.x = { min: x, max: x };
	}
	if (y !== null) {
		limits.y = { min: y, max: y };
	}
	return limits;
}

function parsePointArguments(body: string, cursor: number): { x: string; y: string; end: number } {
	while (cursor < body.length && /\s/.test(body[cursor])) {
		cursor++;
	}

	const first = findBracedArgument(body, cursor);
	if (!first) {
		throw new GraphSyntaxError(
			'\\point must be followed by coordinates.',
			'Examples: \\point{2, 3}, \\point{(2,3)}, \\point{2}{3}, \\point[red, label={A}]{1, 2}.',
		);
	}

	let afterFirst = first.end;
	while (afterFirst < body.length && /\s/.test(body[afterFirst])) {
		afterFirst++;
	}

	const second = findBracedArgument(body, afterFirst);
	if (second && !first.content.includes(',') && !first.content.includes(';')) {
		return { x: first.content.trim(), y: second.content.trim(), end: second.end };
	}

	const pair = parseCoordinatePair(first.content);
	if (!pair) {
		throw new GraphSyntaxError(
			'Could not parse point coordinates.',
			'Use \\point{x, y}, \\point{(x,y)}, or \\point{x}{y}.',
		);
	}

	return { x: pair.x, y: pair.y, end: first.end };
}

function convertPointToPlot(
	options: string,
	xRaw: string,
	yRaw: string,
	parameters: GraphParameter[] = [],
	plotIndex: number,
): PlotConversion {
	const x = substituteParameters(xRaw.trim(), parameters);
	const y = substituteParameters(yRaw.trim(), parameters);
	const style = applyPlotStyleOptions(options.trim(), plotIndex);
	const plotOpts = mergePlotOptions(
		style.cleanedOptions,
		[['mark size', '2.5pt']],
		['only marks', 'mark=*', ...style.extraPlotOpts],
	);

	const lines = [`\\addplot[${plotOpts}] coordinates {(${x}, ${y})};`];
	appendLegend(lines, style.legendLabel);
	if (extractOptionValue(options, 'label')) {
		const label = extractOptionValue(options, 'label')!;
		const labelText = label.replace(/^\{|\}$/g, '').trim();
		lines.push(`\\node[pin=90:{${labelText}}] at (axis cs:${x}, ${y}) {};`);
	}

	return {
		line: lines.join('\n'),
		limits: limitsFromCoordinatePair(x, y),
		legendLabel: style.legendLabel,
	};
}

function parseCoordinateList(content: string): Array<{ x: string; y: string }> {
	const trimmed = content.trim();
	if (!trimmed) {
		return [];
	}

	if (trimmed.includes(';')) {
		const pairs: Array<{ x: string; y: string }> = [];
		for (const chunk of trimmed.split(';').map(part => part.trim()).filter(Boolean)) {
			const pair = parseCoordinatePair(chunk);
			if (pair) {
				pairs.push(pair);
			}
		}
		return pairs;
	}

	const parenMatches = [...trimmed.matchAll(/\(\s*([^,()]+)\s*,\s*([^)]+)\s*\)/g)];
	if (parenMatches.length > 0) {
		return parenMatches.map(match => ({ x: match[1].trim(), y: match[2].trim() }));
	}

	const flat = trimmed.split(',').map(part => part.trim()).filter(Boolean);
	if (flat.length >= 2 && flat.length % 2 === 0) {
		const pairs: Array<{ x: string; y: string }> = [];
		for (let i = 0; i < flat.length; i += 2) {
			pairs.push({ x: flat[i], y: flat[i + 1] });
		}
		return pairs;
	}

	const pair = parseCoordinatePair(trimmed);
	return pair ? [pair] : [];
}

function convertPointsToPlot(
	options: string,
	content: string,
	parameters: GraphParameter[] = [],
	plotIndex: number,
): PlotConversion {
	const pairs = parseCoordinateList(content);
	if (pairs.length === 0) {
		throw graphSyntaxError(
			'Could not parse \\points coordinates.',
			'Examples: \\points{(1,2), (3,4)} or \\points{1,2; 3,4}.',
		);
	}

	const style = applyPlotStyleOptions(options.trim(), plotIndex);
	const coords = pairs
		.map(pair => {
			const x = substituteParameters(pair.x, parameters);
			const y = substituteParameters(pair.y, parameters);
			return `(${x}, ${y})`;
		})
		.join(' ');

	const plotOpts = mergePlotOptions(
		style.cleanedOptions,
		[['mark size', '2.5pt']],
		['only marks', 'mark=*', ...style.extraPlotOpts],
	);

	let limits = emptyAxisLimits();
	for (const pair of pairs) {
		limits = mergeAxisLimits(limits, limitsFromCoordinatePair(
			substituteParameters(pair.x, parameters),
			substituteParameters(pair.y, parameters),
		));
	}

	return {
		line: `\\addplot[${plotOpts}] coordinates {${coords}};`,
		limits,
		legendLabel: style.legendLabel,
	};
}

function convertShadeToPlot(
	options: string,
	expression: string,
	parameters: GraphParameter[] = [],
	plotIndex: number,
): PlotConversion {
	const inequality = parseInequality(expression);
	const style = applyPlotStyleOptions(options.trim(), plotIndex);
	const opacity = style.fillOpacity ?? 0.2;
	const colorOpt = style.extraPlotOpts.find(opt => !opt.includes('=')) ?? DEFAULT_PLOT_COLOR;

	if (inequality?.kind === 'implicit') {
		const fallback = tryInequalityCircleFill(substituteParameters(expression, parameters));
		if (fallback) {
			return {
				line: fallback.line,
				limits: {
					x: fallback.limits?.x,
					y: fallback.limits?.y,
					explicitX: false,
					explicitY: false,
				},
			};
		}
	}

	const domain = extractOptionValue(options, 'domain') ?? '-5:5';
	const yDomain = extractOptionValue(options, 'y domain') ?? domain;
	const limits = emptyAxisLimits();
	const xRange = parseNumericRange(domain);
	const yRange = parseNumericRange(yDomain);
	if (xRange) {
		limits.x = xRange;
	}
	if (yRange) {
		limits.y = yRange;
	}

	if (inequality && (inequality.kind === 'y_below' || inequality.kind === 'y_above')) {
		const expr = substituteParameters(inequality.expr, parameters);
		if (inequality.kind === 'y_below') {
			return {
				line: buildFilledCycleLine(domain, expr, colorOpt, opacity),
				limits,
			};
		}

		const ymax = yRange?.max ?? 5;
		return {
			line: [
				`\\addplot[name path=shadeTop${plotIndex}, draw=none, domain=${domain}] {${ymax}};`,
				`\\addplot[name path=shadeCurve${plotIndex}, draw=none, domain=${domain}] {${expr}};`,
				`\\addplot[${colorOpt}, fill opacity=${opacity}, draw=none] fill between[of=shadeTop${plotIndex} and shadeCurve${plotIndex}];`,
			].join('\n'),
			limits,
			needsFillBetween: true,
		};
	}

	const implicitExpr = substituteParameters(expression.replace(/\s*(<=|>=|<|>)\s*/g, ' - '), parameters);
	const fallback = tryImplicitFallback(implicitExpr, true);
	if (fallback) {
		return {
			line: fallback.line,
			limits: {
				x: fallback.limits?.x,
				y: fallback.limits?.y,
				explicitX: false,
				explicitY: false,
			},
		};
	}

	throw graphSyntaxError(
		`Could not shade region "${expression}".`,
		'Examples: \\shade{y < x^2}, \\shade{y > sin(x)}, \\shade{x^2 + y^2 <= 9}.',
	);
}

function convertRootsToPlot(
	options: string,
	expression: string,
	parameters: GraphParameter[] = [],
	plotIndex: number,
): PlotConversion {
	const expr = substituteParameters(parseRootExpression(expression), parameters);
	const domainText = extractOptionValue(options, 'domain') ?? '-5:5';
	const domain = parseNumericRange(domainText);
	if (!domain) {
		throw graphSyntaxError('Invalid domain for \\roots.', 'Example: \\roots[domain=-5:5]{sin(x)}.');
	}

	const roots = findRootsNumeric(expr, domain);
	const style = applyPlotStyleOptions(options.trim(), plotIndex);
	const plotOpts = mergePlotOptions(style.cleanedOptions, [], ['only marks', 'mark=*', ...style.extraPlotOpts]);
	const coords = formatAnalysisCoordinates(roots);

	let limits = emptyAxisLimits();
	for (const root of roots) {
		limits = mergeAxisLimits(limits, limitsFromCoordinatePair(String(root.x), String(root.y)));
	}

	return {
		line: roots.length > 0
			? `\\addplot[${plotOpts}] coordinates {${coords}};`
			: `% no roots found for ${expr}`,
		limits,
		legendLabel: style.legendLabel,
	};
}

function convertIntersectToPlot(
	options: string,
	expression: string,
	parameters: GraphParameter[] = [],
	plotIndex: number,
): PlotConversion {
	const { exprA, exprB } = (() => {
		try {
			return parseIntersectExpressions(expression);
		} catch (err) {
			throw graphSyntaxError(
				err instanceof Error ? err.message : 'Could not parse \\intersect expressions.',
				'Example: \\intersect{y = x^2, y = 2*x}.',
			);
		}
	})();
	const left = substituteParameters(parseRootExpression(exprA), parameters);
	const right = substituteParameters(parseRootExpression(exprB), parameters);
	const domainText = extractOptionValue(options, 'domain') ?? '-5:5';
	const domain = parseNumericRange(domainText);
	if (!domain) {
		throw graphSyntaxError('Invalid domain for \\intersect.', 'Example: \\intersect[domain=-2:4]{y = x^2, y = 2*x}.');
	}

	const points = findIntersectionNumeric(left, right, domain);
	const style = applyPlotStyleOptions(options.trim(), plotIndex);
	const plotOpts = mergePlotOptions(style.cleanedOptions, [], ['only marks', 'mark=o', ...style.extraPlotOpts]);
	const coords = formatAnalysisCoordinates(points);

	let limits = emptyAxisLimits();
	for (const point of points) {
		limits = mergeAxisLimits(limits, limitsFromCoordinatePair(String(point.x), String(point.y)));
	}

	return {
		line: points.length > 0
			? `\\addplot[${plotOpts}] coordinates {${coords}};`
			: `% no intersections found`,
		limits,
		legendLabel: style.legendLabel,
	};
}

function convertLineToPlot(
	options: string,
	expression: string,
	parameters: GraphParameter[] = [],
): PlotConversion {
	const body = expression.trim();
	const vertical = /^x\s*=\s*(.+)$/i.exec(body);
	if (vertical) {
		const xExpr = substituteParameters(vertical[1].trim(), parameters);
		const lineOpts = mergePlotOptions(options.trim(), [
			['domain', '-5:5'],
			['samples', '2'],
		]);
		const xNum = parseNumericLiteral(xExpr);
		const limits = emptyAxisLimits();
		if (xNum !== null) {
			limits.x = { min: xNum, max: xNum };
		}
		return {
			line: `\\addplot[${lineOpts}] ({${xExpr}}, {x});`,
			limits,
		};
	}

	const horizontal = /^y\s*=\s*(.+)$/i.exec(body);
	if (horizontal) {
		const plot = convertFunctionToPlot(options, body, parameters, 0);
		if (!plot) {
			throw new GraphSyntaxError(
				`Could not plot horizontal line "${body}".`,
				'Example: \\line{y = 2} or \\line[domain=-3:3]{y = x + 1}.',
			);
		}
		return plot;
	}

	throw new GraphSyntaxError(
		`Could not interpret line "${body}".`,
		'Use \\line{x = 5} for vertical lines or \\line{y = 2} for horizontal lines.',
	);
}

function emptyAxisLimits(): AxisLimits {
	return { explicitX: false, explicitY: false };
}

function findOptionalBrackets(text: string, start: number): ParsedBrackets | null {
	if (text[start] !== '[') {
		return null;
	}

	let depth = 0;
	for (let i = start; i < text.length; i++) {
		const char = text[i];
		if (char === '\\') {
			i++;
			continue;
		}

		if (char === '[') {
			depth++;
		} else if (char === ']') {
			depth--;
			if (depth === 0) {
				return { content: text.slice(start + 1, i), end: i + 1 };
			}
		}
	}

	return null;
}

function parseBracedArgument(text: string, start: number): ParsedBraces | null {
	return findBracedArgument(text, start);
}

function isNumericRange(value: string): boolean {
	return NUMERIC_RANGE_PATTERN.test(value.trim());
}

function parseNumericRange(value: string): NumericRange | null {
	const match = value.trim().match(NUMERIC_RANGE_PATTERN);
	if (!match) {
		return null;
	}

	const min = Number.parseFloat(match[1]);
	const max = Number.parseFloat(match[2]);
	if (!Number.isFinite(min) || !Number.isFinite(max)) {
		return null;
	}

	return min <= max ? { min, max } : { min: max, max: min };
}

function isSizeValue(value: string): boolean {
	const trimmed = value.trim();
	return SIZE_UNIT_PATTERN.test(trimmed) || /^(width|height)\s*=/i.test(trimmed);
}

function parseAxisBraces(sizeArg: string): ParsedAxisBraces {
	const trimmed = sizeArg.trim();

	if (!trimmed) {
		return {
			kind: 'size',
			width: DEFAULT_AXIS_WIDTH,
			height: DEFAULT_AXIS_HEIGHT,
		};
	}

	if (trimmed.includes('=')) {
		return {
			kind: 'kv',
			width: '',
			height: '',
			kvOptions: trimmed,
		};
	}

	const parts = splitAxisArgList(trimmed);

	if (parts.length === 4) {
		const [width, height, xToken, yToken] = parts;
		const xRange = parseNumericRange(xToken);
		const yRange = parseNumericRange(yToken);
		if (isSizeValue(width) && isSizeValue(height) && xRange && yRange) {
			return {
				kind: 'combined',
				width,
				height,
				xRange,
				yRange,
			};
		}
	}

	if (parts.length === 2) {
		const [first, second] = parts;
		const firstRange = parseNumericRange(first);
		const secondRange = parseNumericRange(second);

		if (firstRange && secondRange) {
			return {
				kind: 'range',
				width: '',
				height: '',
				xRange: firstRange,
				yRange: secondRange,
			};
		}

		return {
			kind: 'size',
			width: first || DEFAULT_AXIS_WIDTH,
			height: second || DEFAULT_AXIS_HEIGHT,
		};
	}

	if (parts.length === 1) {
		const xRange = parseNumericRange(parts[0]);
		if (xRange) {
			return {
				kind: 'range',
				width: '',
				height: '',
				xRange,
			};
		}

		return {
			kind: 'size',
			width: parts[0] || DEFAULT_AXIS_WIDTH,
			height: DEFAULT_AXIS_HEIGHT,
		};
	}

	return {
		kind: 'size',
		width: DEFAULT_AXIS_WIDTH,
		height: DEFAULT_AXIS_HEIGHT,
	};
}

function parseAxisCommand(body: string): ParsedAxisCommand {
	const axisMatch = body.match(/\\axis\b/);
	if (!axisMatch || axisMatch.index === undefined) {
		return {
			bracketOpts: '',
			sizeArg: `${DEFAULT_AXIS_WIDTH},${DEFAULT_AXIS_HEIGHT}`,
			remaining: body.trim(),
		};
	}

	let index = axisMatch.index + '\\axis'.length;
	let bracketOpts = '';

	const brackets = findOptionalBrackets(body, index);
	if (brackets) {
		bracketOpts = brackets.content;
		index = brackets.end;
	}

	while (index < body.length && /\s/.test(body[index])) {
		index++;
	}

	const braces = parseBracedArgument(body, index);
	const sizeArg = braces?.content ?? `${DEFAULT_AXIS_WIDTH},${DEFAULT_AXIS_HEIGHT}`;

	const before = body.slice(0, axisMatch.index).trim();
	const after = braces ? body.slice(braces.end).trim() : body.slice(index).trim();
	const remaining = [before, after].filter(Boolean).join('\n');

	return { bracketOpts, sizeArg, remaining };
}

function extractOptionValue(options: string, name: string): string | null {
	const match = options.match(new RegExp(`(?:^|,\\s*)${name}\\s*=\\s*([^,]+)`));
	return match?.[1]?.trim() ?? null;
}

function extractAxisLimitsFromOptions(options: string): { limits: AxisLimits; cleanedOptions: string } {
	const limits = emptyAxisLimits();
	let cleanedOptions = options.trim();

	const xmin = extractOptionValue(cleanedOptions, 'xmin');
	const xmax = extractOptionValue(cleanedOptions, 'xmax');
	const ymin = extractOptionValue(cleanedOptions, 'ymin');
	const ymax = extractOptionValue(cleanedOptions, 'ymax');
	const domain = extractOptionValue(cleanedOptions, 'domain');
	const yDomain = extractOptionValue(cleanedOptions, 'y domain');

	if (xmin !== null && xmax !== null) {
		const min = Number.parseFloat(xmin);
		const max = Number.parseFloat(xmax);
		if (Number.isFinite(min) && Number.isFinite(max)) {
			limits.x = min <= max ? { min, max } : { min: max, max: min };
			limits.explicitX = true;
		}
	} else if (domain) {
		const range = parseNumericRange(domain);
		if (range) {
			limits.x = range;
			limits.explicitX = true;
		}
	}

	if (ymin !== null && ymax !== null) {
		const min = Number.parseFloat(ymin);
		const max = Number.parseFloat(ymax);
		if (Number.isFinite(min) && Number.isFinite(max)) {
			limits.y = min <= max ? { min, max } : { min: max, max: min };
			limits.explicitY = true;
		}
	} else if (yDomain) {
		const range = parseNumericRange(yDomain);
		if (range) {
			limits.y = range;
			limits.explicitY = true;
		}
	}

	for (const optionName of ['xmin', 'xmax', 'ymin', 'ymax', 'domain', 'y domain']) {
		cleanedOptions = stripPlotOption(cleanedOptions, optionName);
	}

	return { limits, cleanedOptions };
}

function unionRange(a: NumericRange, b: NumericRange): NumericRange {
	return {
		min: Math.min(a.min, b.min),
		max: Math.max(a.max, b.max),
	};
}

function mergeAxisLimits(base: AxisLimits, incoming: AxisLimits): AxisLimits {
	const merged: AxisLimits = {
		x: base.x,
		y: base.y,
		explicitX: base.explicitX,
		explicitY: base.explicitY,
	};

	if (incoming.x) {
		merged.x = merged.x ? unionRange(merged.x, incoming.x) : incoming.x;
		if (incoming.explicitX) {
			merged.explicitX = true;
		}
	}

	if (incoming.y) {
		merged.y = merged.y ? unionRange(merged.y, incoming.y) : incoming.y;
		if (incoming.explicitY) {
			merged.explicitY = true;
		}
	}

	return merged;
}

function applyParsedAxisBraces(limits: AxisLimits, parsed: ParsedAxisBraces): AxisLimits {
	if (parsed.kind !== 'range' && parsed.kind !== 'combined') {
		return limits;
	}

	const next = { ...limits };
	if (parsed.xRange) {
		next.x = parsed.xRange;
		next.explicitX = true;
	}
	if (parsed.yRange) {
		next.y = parsed.yRange;
		next.explicitY = true;
	}
	return next;
}

function formatLimitOptions(limits: AxisLimits): string[] {
	const parts: string[] = [];
	if (limits.x) {
		parts.push(`xmin=${limits.x.min}`, `xmax=${limits.x.max}`);
	}
	if (limits.y) {
		parts.push(`ymin=${limits.y.min}`, `ymax=${limits.y.max}`);
	}
	return parts;
}

function buildAxisOptions(
	parsedBraces: ParsedAxisBraces,
	bracketOpts: string,
	limits: AxisLimits,
	equalAspect = false,
	extraAxisOptions?: string,
	hasSurface3d = false,
): string {
	const parts = [hasSurface3d ? pgfplots3dAxisCoreOptions() : DEFAULT_AXIS_OPTIONS];
	const hasFullWindow = Boolean(limits.x && limits.y);

	if (hasSurface3d) {
		parts.push('enlargelimits=false');
	} else {
		parts.push(hasFullWindow ? 'enlargelimits=false' : 'enlargelimits=true');
	}

	if (equalAspect) {
		parts.push('axis equal image');
	}

	if (extraAxisOptions?.trim() && !hasSurface3d) {
		parts.push(extraAxisOptions.trim());
	}

	if (parsedBraces.kind === 'kv' && parsedBraces.kvOptions) {
		parts.push(parsedBraces.kvOptions);
	} else if (parsedBraces.kind === 'size' || parsedBraces.kind === 'combined') {
		parts.push(`width=${parsedBraces.width}`, `height=${parsedBraces.height}`);
	} else if (parsedBraces.kind === 'range') {
		parts.push(`width=${DEFAULT_AXIS_WIDTH}`, `height=${DEFAULT_AXIS_HEIGHT}`);
	}

	if (bracketOpts.trim()) {
		parts.push(bracketOpts.trim());
	}

	parts.push(...formatLimitOptions(limits));

	return parts.filter(Boolean).join(', ');
}

function hasPlotOption(options: string, name: string): boolean {
	return new RegExp(`(?:^|,\\s*)${name}(?:\\s*=|\\s*,|$)`).test(options);
}

function hasPlotOptionValue(options: string, name: string): boolean {
	return new RegExp(`(?:^|,\\s*)${name}\\s*=`).test(options);
}

function mergePlotOptions(plotOpts: string, defaults: Array<[string, string]>, extra: string[] = []): string {
	const parts: string[] = [];
	if (plotOpts.trim()) {
		parts.push(plotOpts.trim());
	}

	for (const [key, value] of defaults) {
		if (!hasPlotOptionValue(plotOpts, key)) {
			parts.push(`${key}=${value}`);
		}
	}

	parts.push(...extra.filter(Boolean));
	return parts.filter(Boolean).join(', ');
}

function stripPlotOption(options: string, name: string): string {
	return options
		.replace(new RegExp(`(?:^|,\\s*)${name}(?:\\s*=\\s*[^,]+)?`, 'g'), '')
		.replace(/^,\s*/, '')
		.replace(/,\s*$/, '')
		.trim();
}

function plotModeFromOptions(options: string): PlotMode {
	if (hasPlotOption(options, 'ode')) return 'ode';
	if (hasPlotOption(options, 'implicit')) return 'implicit';
	if (hasPlotOption(options, 'pde')) return 'pde';
	if (hasPlotOption(options, '3d')) return '3d';
	if (hasPlotOption(options, 'parametric')) return 'parametric';
	if (hasPlotOption(options, 'polar')) return 'polar';
	return 'standard';
}

function plotLimitsFromUserOptions(
	originalOpts: string,
	resolvedOpts: string,
	mode: PlotMode = 'standard',
	cartesianEstimate?: { x: NumericRange; y: NumericRange } | null,
): AxisLimits {
	const limits = emptyAxisLimits();

	if (mode === 'polar' || mode === 'parametric') {
		if (cartesianEstimate) {
			limits.x = cartesianEstimate.x;
			limits.y = cartesianEstimate.y;
		}
		return limits;
	}

	const userDomain = hasPlotOptionValue(originalOpts, 'domain');
	const userYDomain = hasPlotOptionValue(originalOpts, 'y domain');

	if (userDomain) {
		const domain = extractOptionValue(resolvedOpts, 'domain');
		const xRange = domain ? parseNumericRange(domain) : null;
		if (xRange) {
			limits.x = xRange;
		}
	}

	if (userYDomain) {
		const yDomain = extractOptionValue(resolvedOpts, 'y domain');
		const yRange = yDomain ? parseNumericRange(yDomain) : null;
		if (yRange) {
			limits.y = yRange;
		}
	} else if (limits.x && (mode === 'implicit' || mode === 'ode') && userDomain) {
		limits.y = limits.x;
	}

	if (mode === 'standard' || mode === '3d' || mode === 'pde') {
		if (!userYDomain && userDomain && hasPlotOptionValue(resolvedOpts, 'y domain')) {
			const yDomain = extractOptionValue(resolvedOpts, 'y domain');
			const yRange = yDomain ? parseNumericRange(yDomain) : null;
			if (yRange) {
				limits.y = yRange;
			}
		}
	}

	return limits;
}

function validateGraphBlockStructure(body: string): void {
	const axisCount = (body.match(/\\axis\b/g) ?? []).length;
	if (axisCount > 1) {
		throw new GraphSyntaxError(
			'Only one \\axis command is allowed per graph block.',
			'Combine size and window in one axis, e.g. \\axis{6cm,4cm, -3:3, -2:2}.',
		);
	}
}

function extractParameterDomain(resolvedOpts: string, fallback = '0:360'): NumericRange | null {
	const domain = extractOptionValue(resolvedOpts, 'domain') ?? fallback;
	return domain ? parseNumericRange(domain) : null;
}

function resolvePlotDomain(resolvedOpts: string, fallback: string): NumericRange | null {
	return extractParameterDomain(resolvedOpts, fallback);
}

function resolveTrigDegrees(resolvedOpts: string, fallbackDomain: string): boolean {
	const domain = resolvePlotDomain(resolvedOpts, fallbackDomain);
	return domain ? isLikelyDegreeDomain(domain) : false;
}

function trigPlotOptions(trigDegrees: boolean): string[] {
	return trigDegrees ? ['trig format plots=deg'] : [];
}

function mergePlotLimitsIntoAxis(axisLimits: AxisLimits, plotLimits: AxisLimits): AxisLimits {
	const merged: AxisLimits = {
		x: axisLimits.x,
		y: axisLimits.y,
		explicitX: axisLimits.explicitX,
		explicitY: axisLimits.explicitY,
	};

	if (!merged.explicitX && plotLimits.x) {
		merged.x = merged.x ? unionRange(merged.x, plotLimits.x) : plotLimits.x;
	}

	if (!merged.explicitY && plotLimits.y) {
		merged.y = merged.y ? unionRange(merged.y, plotLimits.y) : plotLimits.y;
	}

	return merged;
}

function ensureOdePlotOptions(plotOpts: string): string {
	if (!hasPlotOptionValue(plotOpts, 'domain') && !hasPlotOptionValue(plotOpts, 'y domain')) {
		return 'domain=-3:3, y domain=-3:3';
	}

	if (hasPlotOptionValue(plotOpts, 'domain') && !hasPlotOptionValue(plotOpts, 'y domain')) {
		return mergePlotOptions(plotOpts, [['y domain', '-3:3']], []);
	}

	return plotOpts.trim() || 'domain=-3:3, y domain=-3:3';
}

function isValidPlotPart(part: string): boolean {
	const trimmed = part.trim();
	if (!trimmed) {
		return false;
	}

	if (/^\\+$/.test(trimmed)) {
		return false;
	}

	if (/^;+$/.test(trimmed)) {
		return false;
	}

	if (/\\?\$\{[^}]*\}/.test(trimmed)) {
		return false;
	}

	return true;
}

function stripModeFlags(options: string): string {
	const flags = ['ode', 'solution', 'odesol', 'implicit', 'pde', '3d', 'parametric', 'polar'];
	return flags.reduce((current, flag) => stripPlotOption(current, flag), options);
}

function stripOdeIcOptions(options: string): string {
	return stripPlotOption(stripPlotOption(stripPlotOption(stripPlotOption(options, 'x0'), 'y0'), 'yp0'), "y'0");
}

function convertFunctionToPlot(
	options: string,
	expression: string,
	parameters: GraphParameter[] = [],
	plotIndex: number,
	lastNamePath?: string,
): PlotConversion | null {
	const opts = options.trim();
	const body = expression.trim();
	if (!body || !isValidPlotPart(body)) {
		return null;
	}

	const odeSolution = hasOdeSolutionFlag(opts);
	const initialMode = plotModeFromOptions(opts);
	const style = applyPlotStyleOptions(opts, plotIndex);
	let cleanedOpts = stripModeFlags(style.cleanedOptions);

	let normalized;
	try {
		normalized = normalizeFunctionExpression(expression, initialMode, odeSolution);
	} catch (err) {
		if (err instanceof GraphSyntaxError) {
			throw err;
		}
		throw err;
	}

	const resolvedMode = resolvePlotMode(opts, normalized);
	let plotOpts = stripOdeIcOptions(cleanedOpts);
	const rawExpr = normalized.pgfExpr;
	const extraStyle = style.extraPlotOpts.length > 0 ? `, ${style.extraPlotOpts.join(', ')}` : '';

	if ((resolvedMode === 'ode' || normalized.kind === 'ode_slope') && odeSolution) {
		let parsedOde;
		try {
			parsedOde = parseOdeExpression(body, true);
		} catch (err) {
			throw graphSyntaxError(
				err instanceof Error ? err.message : 'Could not parse ODE expression.',
				'Use [ode, solution]{dy/dx = f(x,y)} with x0, y0, or y\'\' = f(x,y,y\') with yp0.',
			);
		}
		const ic = extractOdeInitialConditions(opts);
		const domainText = extractOptionValue(plotOpts, 'domain') ?? '-3:3';
		const xRange = parseNumericRange(domainText) ?? { min: -3, max: 3 };
		const points = parsedOde.kind === 'second_order_solution'
			? solveSecondOrderOde(parsedOde.rhsExpr ?? '0', ic, xRange)
			: solveFirstOrderOde(parsedOde.rhsExpr ?? parsedOde.slopeExpr ?? '0', ic, xRange);
		const coords = formatOdeCoordinates(points);
		const solutionOpts = mergePlotOptions(plotOpts, [], ['thick', ...style.extraPlotOpts]);
		const solutionLines = [`\\addplot[${solutionOpts}] coordinates {${coords}};`];
		appendLegend(solutionLines, style.legendLabel);

		let limits = emptyAxisLimits();
		limits.x = xRange;
		for (const [x, y] of points) {
			limits = mergeAxisLimits(limits, limitsFromCoordinatePair(String(x), String(y)));
		}

		return {
			line: solutionLines.join('\n'),
			limits,
			legendLabel: style.legendLabel,
		};
	}

	if (resolvedMode === 'ode' || normalized.kind === 'ode_slope') {
		const expr = normalizePlotExpression(rawExpr, parameters);
		const resolvedPlotOpts = ensureOdePlotOptions(plotOpts);
		const odeOpts = [
			resolvedPlotOpts + extraStyle,
			'samples=20',
			'quiver',
			`quiver={u=1, v={${expr}}, scale arrows=0.15}`,
		].filter(Boolean).join(', ');
		const odeLines = [`\\addplot3[${odeOpts}] (x,y,0);`];
		appendLegend(odeLines, style.legendLabel);

		return {
			line: odeLines.join('\n'),
			limits: plotLimitsFromUserOptions(opts, resolvedPlotOpts, 'ode'),
			legendLabel: style.legendLabel,
		};
	}

	if (resolvedMode === 'implicit' || normalized.kind === 'implicit') {
		const expr = normalizePlotExpression(rawExpr, parameters);
		const fallback = tryImplicitFallback(expr);
		if (fallback) {
			const lines = [fallback.line];
			appendLegend(lines, style.legendLabel);
			return {
				line: lines.join('\n'),
				limits: {
					x: fallback.limits?.x,
					y: fallback.limits?.y,
					explicitX: false,
					explicitY: false,
				},
				requiresEqualAspect: true,
				legendLabel: style.legendLabel,
			};
		}

		const resolvedPlotOpts = mergePlotOptions(plotOpts, [
			['domain', '-5:5'],
			['y domain', '-5:5'],
			['samples', '61'],
			['samples y', '61'],
		]);
		const implicitOpts = [
			resolvedPlotOpts + extraStyle,
			'contour lua={levels={0},labels=false}',
		].join(', ');

		return {
			line: `\\addplot3[${implicitOpts}] {${expr}};`,
			limits: plotLimitsFromUserOptions(opts, resolvedPlotOpts, 'implicit'),
			legendLabel: style.legendLabel,
		};
	}

	if (resolvedMode === '3d' || resolvedMode === 'pde' || normalized.kind === 'surface') {
		const expr = normalizePlotExpression(rawExpr, parameters);
		const resolvedPlotOpts = mergePlotOptions(plotOpts, [
			['domain', '-2:2'],
			['y domain', '-2:2'],
		]);
		const surfOpts = [
			'mesh',
			'thick',
			'point meta=z',
			'colormap/hot',
			resolvedPlotOpts,
			'samples=20',
			...style.extraPlotOpts.filter(opt => /colormap|shader|surf|mesh|draw|point meta|mathgraphLine|black/i.test(opt)),
		].filter(Boolean).join(', ');
		return {
			line: `\\addplot3[${surfOpts}] {${expr}};`,
			limits: plotLimitsFromUserOptions(opts, resolvedPlotOpts, resolvedMode),
			isSurface3d: true,
			legendLabel: style.legendLabel,
		};
	}

	if (resolvedMode === 'parametric') {
		const parts = rawExpr.split(';').map(part => part.trim());
		const xExpr = parts[0] ?? '';
		const yExpr = parts[1] ?? '';
		if (!isValidPlotPart(xExpr) || !isValidPlotPart(yExpr)) {
			throw new GraphSyntaxError(
				'Parametric plots need two expressions separated by ;.',
				'Example: \\function[parametric, domain=0:360]{cos(x); sin(x)}.',
			);
		}

		const xPlot = normalizePlotExpression(xExpr, parameters);
		const yPlot = normalizePlotExpression(yExpr, parameters);

		const paramOpts = mergePlotOptions(plotOpts, [
			['domain', '0:360'],
			['samples', '200'],
		], ['parametric', ...trigPlotOptions(true)]);
		const tRange = extractParameterDomain(paramOpts);
		const trigDegrees = tRange ? isLikelyDegreeDomain(tRange) : true;
		const finalOpts = trigDegrees
			? paramOpts
			: mergePlotOptions(plotOpts, [
				['domain', '0:360'],
				['samples', '200'],
			], ['parametric']);
		const cartesianEstimate = tRange
			? estimateParametricCartesianRange(xExpr, yExpr, tRange, trigDegrees)
			: { x: { min: -1.2, max: 1.2 }, y: { min: -1.2, max: 1.2 } };

		return {
			line: `\\addplot[${finalOpts}] ({${xPlot}}, {${yPlot}});`,
			limits: plotLimitsFromUserOptions(opts, finalOpts, 'parametric', cartesianEstimate),
			requiresEqualAspect: true,
			legendLabel: style.legendLabel,
		};
	}

	if (resolvedMode === 'polar') {
		const parts = rawExpr.includes(';')
			? rawExpr.split(';').map(part => part.trim())
			: [rawExpr.trim(), 'x'];
		const radiusExpr = parts[0] ?? '';
		const angleExpr = parts[1] ?? 'x';
		if (!isValidPlotPart(radiusExpr) || !isValidPlotPart(angleExpr)) {
			throw new GraphSyntaxError(
				'Polar plots need radius and angle separated by ;.',
				'Example: \\function[polar, domain=0:360]{cos(2*x); x}.',
			);
		}

		const radiusPlot = normalizePlotExpression(radiusExpr, parameters);
		const anglePlot = normalizePlotExpression(angleExpr, parameters);

		const polarOpts = mergePlotOptions(plotOpts, [
			['domain', '0:360'],
			['samples', '200'],
		], ['data cs=polar', ...trigPlotOptions(true)]);
		const tRange = extractParameterDomain(polarOpts);
		const trigDegrees = tRange ? isLikelyDegreeDomain(tRange) : true;
		const finalOpts = trigDegrees
			? polarOpts
			: mergePlotOptions(plotOpts, [
				['domain', '0:360'],
				['samples', '200'],
			], ['data cs=polar']);
		const cartesianEstimate = tRange
			? estimatePolarCartesianRange(radiusExpr, angleExpr, tRange, trigDegrees)
			: { x: { min: -1.2, max: 1.2 }, y: { min: -1.2, max: 1.2 } };
		const angleIsParameter = /^x$/i.test(anglePlot);
		const plotCoords = angleIsParameter
			? `(x, {${radiusPlot}})`
			: `({${anglePlot}}, {${radiusPlot}})`;

		return {
			line: `\\addplot[${finalOpts}] ${plotCoords};`,
			limits: plotLimitsFromUserOptions(opts, finalOpts, 'polar', cartesianEstimate),
			requiresEqualAspect: true,
			legendLabel: style.legendLabel,
		};
	}

	const expr = normalizePlotExpression(rawExpr, parameters);
	const addplotOpts = mergePlotOptions(plotOpts, [
		['domain', '-5:5'],
		['samples', '100'],
	]);
	const trigDegrees = resolveTrigDegrees(addplotOpts, '-5:5');
	const plotColorOpts = style.extraPlotOpts.length > 0
		? style.extraPlotOpts
		: [DEFAULT_PLOT_COLOR, 'thick'];
	const finalAddplotOpts = trigDegrees
		? mergePlotOptions(addplotOpts, [], [...trigPlotOptions(true), ...plotColorOpts])
		: mergePlotOptions(addplotOpts, [], plotColorOpts);
	const limits = plotLimitsFromUserOptions(opts, finalAddplotOpts);

	if (limits.x && !limits.y) {
		const yEstimate = estimateExplicitYRange(expr, limits.x, trigDegrees);
		if (yEstimate) {
			limits.y = yEstimate;
		}
	}

	const domain = extractOptionValue(finalAddplotOpts, 'domain') ?? '-5:5';
	const needsNamePath = style.fillMode === 'between';
	const namePathOpt = needsNamePath ? `, name path=${style.namePath}` : '';
	const mainLine = `\\addplot[${finalAddplotOpts}${namePathOpt}] {${expr}};`;
	const lines: string[] = [mainLine];
	appendLegend(lines, style.legendLabel);

	if (style.fillMode === 'under') {
		lines.push(buildFilledCycleLine(domain, expr, style.extraPlotOpts[0] ?? DEFAULT_PLOT_COLOR, style.fillOpacity ?? 0.2));
	} else if (style.fillMode === 'between' && lastNamePath && style.namePath) {
		lines.push(buildFillBetweenLine(
			lastNamePath,
			style.namePath,
			style.extraPlotOpts[0] ?? DEFAULT_PLOT_COLOR,
			style.fillOpacity ?? 0.15,
		));
	}

	return {
		line: lines.join('\n'),
		limits,
		legendLabel: style.legendLabel,
		needsFillBetween: style.fillMode === 'under' || style.fillMode === 'between',
		namePath: style.namePath,
	};
}

function replaceGraphCommands(body: string, parameters: GraphParameter[] = [], baseLine = 1): ReplaceGraphCommandsResult {
	let result = '';
	let index = 0;
	let combinedLimits = emptyAxisLimits();
	let equalAspectRequired = 0;
	let hasSurface3d = false;
	let hasCartesian2d = false;
	let plotCount = 0;
	let plotIndex = 0;
	let lastNamePath: string | undefined;
	let needsFillBetween = false;

	while (index < body.length) {
		const nextCmd = findNextGraphCommand(body, index);
		if (!nextCmd) {
			result += body.slice(index);
			break;
		}

		result += body.slice(index, nextCmd.start);
		let cursor = nextCmd.start + `\\${nextCmd.kind}`.length;
		let options = '';
		const cmdLine = lineNumberAt(body, nextCmd.start, baseLine);

		const brackets = findOptionalBrackets(body, cursor);
		if (brackets) {
			options = brackets.content;
			cursor = brackets.end;
		}

		const throwAt = (message: string, hint?: string) => {
			throw graphSyntaxError(message, hint, cmdLine);
		};

		if (nextCmd.kind === 'function') {
			while (cursor < body.length && /\s/.test(body[cursor])) {
				cursor++;
			}

			const braces = findBracedArgument(body, cursor);
			if (!braces) {
				throwAt(
					'\\function must be followed by a braced expression.',
					'Example: \\function[domain=-2:2]{y = x^2}.',
				);
			}

			plotIndex++;
			const plot = convertFunctionToPlot(options, braces.content, parameters, plotIndex, lastNamePath);
			if (plot) {
				result += plot.line + '\n';
				combinedLimits = mergeAxisLimits(combinedLimits, plot.limits);
				plotCount++;
				if (plot.isSurface3d) {
					hasSurface3d = true;
				} else {
					hasCartesian2d = true;
				}
				if (plot.requiresEqualAspect) {
					equalAspectRequired++;
				}
				if (plot.needsFillBetween) {
					needsFillBetween = true;
				}
				if (plot.namePath) {
					lastNamePath = plot.namePath;
				}
			}

			index = braces.end;
			continue;
		}

		if (nextCmd.kind === 'point') {
			const pointArgs = parsePointArguments(body, cursor);
			plotIndex++;
			const plot = convertPointToPlot(options, pointArgs.x, pointArgs.y, parameters, plotIndex);
			result += plot.line + '\n';
			combinedLimits = mergeAxisLimits(combinedLimits, plot.limits);
			plotCount++;
			hasCartesian2d = true;
			index = pointArgs.end;
			continue;
		}

		if (nextCmd.kind === 'points') {
			while (cursor < body.length && /\s/.test(body[cursor])) {
				cursor++;
			}
			const braces = findBracedArgument(body, cursor);
			if (!braces) {
				throwAt(
					'\\points must be followed by a braced coordinate list.',
					'Example: \\points{(1,2), (3,4)}.',
				);
			}
			plotIndex++;
			const plot = convertPointsToPlot(options, braces.content, parameters, plotIndex);
			result += plot.line + '\n';
			combinedLimits = mergeAxisLimits(combinedLimits, plot.limits);
			plotCount++;
			hasCartesian2d = true;
			index = braces.end;
			continue;
		}

		if (nextCmd.kind === 'shade') {
			while (cursor < body.length && /\s/.test(body[cursor])) {
				cursor++;
			}
			const braces = findBracedArgument(body, cursor);
			if (!braces) {
				throwAt(
					'\\shade must be followed by an inequality.',
					'Example: \\shade{y < x^2}.',
				);
			}
			plotIndex++;
			const plot = convertShadeToPlot(options, braces.content, parameters, plotIndex);
			result += plot.line + '\n';
			combinedLimits = mergeAxisLimits(combinedLimits, plot.limits);
			plotCount++;
			hasCartesian2d = true;
			if (plot.needsFillBetween) {
				needsFillBetween = true;
			}
			index = braces.end;
			continue;
		}

		if (nextCmd.kind === 'roots') {
			while (cursor < body.length && /\s/.test(body[cursor])) {
				cursor++;
			}
			const braces = findBracedArgument(body, cursor);
			if (!braces) {
				throwAt(
					'\\roots must be followed by an expression.',
					'Example: \\roots[domain=-5:5]{sin(x)}.',
				);
			}
			plotIndex++;
			const plot = convertRootsToPlot(options, braces.content, parameters, plotIndex);
			result += plot.line + '\n';
			combinedLimits = mergeAxisLimits(combinedLimits, plot.limits);
			plotCount++;
			hasCartesian2d = true;
			index = braces.end;
			continue;
		}

		if (nextCmd.kind === 'intersect') {
			while (cursor < body.length && /\s/.test(body[cursor])) {
				cursor++;
			}
			const braces = findBracedArgument(body, cursor);
			if (!braces) {
				throwAt(
					'\\intersect must be followed by two expressions.',
					'Example: \\intersect{y = x^2, y = 2*x}.',
				);
			}
			plotIndex++;
			const plot = convertIntersectToPlot(options, braces.content, parameters, plotIndex);
			result += plot.line + '\n';
			combinedLimits = mergeAxisLimits(combinedLimits, plot.limits);
			plotCount++;
			hasCartesian2d = true;
			index = braces.end;
			continue;
		}

		while (cursor < body.length && /\s/.test(body[cursor])) {
			cursor++;
		}

		const lineBraces = findBracedArgument(body, cursor);
		if (!lineBraces) {
			throwAt(
				'\\line must be followed by an equation.',
				'Examples: \\line{x = 5}, \\line{y = 0}, \\line[domain=-3:3]{y = 2}.',
			);
		}

		const plot = convertLineToPlot(options, lineBraces.content, parameters);
		result += plot.line + '\n';
		combinedLimits = mergeAxisLimits(combinedLimits, plot.limits);
		plotCount++;
		hasCartesian2d = true;
		index = lineBraces.end;
	}

	const equalAspect = equalAspectRequired > 0;

	return {
		plotBody: result.trim(),
		limits: combinedLimits,
		equalAspect,
		hasSurface3d,
		hasCartesian2d,
		plotCount,
		needsFillBetween,
	};
}

function isInsideOpenTikzpicture(source: string, graphStartIndex: number): boolean {
	const before = source.slice(0, graphStartIndex);
	const beginCount = (before.match(/\\begin\{tikzpicture\}/g) ?? []).length;
	const endCount = (before.match(/\\end\{tikzpicture\}/g) ?? []).length;
	return beginCount > endCount;
}

function transformGraphBlock(blockBody: string, nestedInTikzpicture: boolean, baseLine = 1): string {
	validateGraphBlockStructure(blockBody);

	const { parameters, remaining: afterParams } = extractGraphParameters(blockBody);
	const { bracketOpts, sizeArg, remaining } = parseAxisCommand(afterParams);
	const parsedBraces = parseAxisBraces(sizeArg);
	const { limits: bracketLimits, cleanedOptions } = extractAxisLimitsFromOptions(bracketOpts);
	const {
		plotBody,
		limits: plotLimits,
		equalAspect,
		hasSurface3d,
		hasCartesian2d,
		plotCount,
		needsFillBetween,
	} = replaceGraphCommands(remaining, parameters, baseLine + blockBody.indexOf(remaining));

	if (plotCount === 0) {
		throw graphSyntaxError(
			'Graph block has no plottable content.',
			'Add \\function{...}, \\point{x, y}, or \\line{x = ...} before rendering.',
			baseLine,
		);
	}

	if (hasSurface3d && hasCartesian2d) {
		throw graphSyntaxError(
			'3D/PDE plots cannot share a graph block with 2D plots.',
			'Use a separate \\begin{graph}...\\end{graph} block for surfaces.',
			baseLine,
		);
	}

	let axisLimits = mergeAxisLimits(bracketLimits, applyParsedAxisBraces(emptyAxisLimits(), parsedBraces));
	axisLimits = mergePlotLimitsIntoAxis(axisLimits, plotLimits);

	const axisOptions = buildAxisOptions(
		parsedBraces,
		cleanedOptions,
		axisLimits,
		equalAspect,
		undefined,
		hasSurface3d,
	);
	const paramDefs = buildParameterDefs(parameters);
	const fillBetweenLib = needsFillBetween ? '\\usepgfplotslibrary{fillbetween}\n' : '';

	const axisBlock = [
		fillBetweenLib,
		paramDefs,
		`\\begin{axis}[${axisOptions}]`,
		plotBody,
		'\\end{axis}',
	].filter(Boolean).join('\n');

	if (nestedInTikzpicture) {
		return axisBlock;
	}

	return [
		'\\begin{tikzpicture}',
		axisBlock,
		'\\end{tikzpicture}',
	].join('\n');
}

export function containsGraphSyntax(source: string): boolean {
	return /\\begin\{graph\}/.test(source);
}

export function expandGraphSyntax(source: string): string {
	if (!containsGraphSyntax(source)) {
		return source;
	}

	let result = '';
	let lastIndex = 0;
	const pattern = /\\begin\{graph\}([\s\S]*?)\\end\{graph\}/g;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(source)) !== null) {
		const blockStart = match.index;
		const body = match[1];
		const blockStartLine = lineNumberAt(source, blockStart, 1);
		result += source.slice(lastIndex, blockStart);
		const nestedInTikzpicture = isInsideOpenTikzpicture(source, blockStart);
		result += transformGraphBlock(body, nestedInTikzpicture, blockStartLine + 1);
		lastIndex = pattern.lastIndex;
	}

	result += source.slice(lastIndex);
	return result;
}

export function isInsideGraphBlock(textBeforeCursor: string): boolean {
	const beginPattern = /\\begin\{graph\}/g;
	let lastBegin = -1;
	let match: RegExpExecArray | null;

	while ((match = beginPattern.exec(textBeforeCursor)) !== null) {
		lastBegin = match.index;
	}

	if (lastBegin === -1) {
		return false;
	}

	const afterBegin = textBeforeCursor.slice(lastBegin);
	return !/\\end\{graph\}/.test(afterBegin);
}
