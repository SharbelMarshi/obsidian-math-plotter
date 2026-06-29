export class GraphSyntaxError extends Error {
	hint?: string;
	line?: number;

	constructor(message: string, hint?: string, line?: number) {
		super(message);
		this.name = 'GraphSyntaxError';
		this.hint = hint;
		this.line = line;
	}
}

export type PlotMode =
	| 'standard'
	| 'ode'
	| 'implicit'
	| 'pde'
	| '3d'
	| 'parametric'
	| 'polar';

export interface NormalizedExpression {
	kind: 'explicit' | 'implicit' | 'ode_slope' | 'parametric' | 'polar' | 'surface';
	pgfExpr: string;
	forcedMode?: PlotMode;
}

export interface GraphParameter {
	name: string;
	value: string;
}

const EXPLICIT_Y_PATTERN = /^y\s*=\s*(.+)$/i;
const ODE_SLOPE_PATTERN = /^(?:dy\s*\/\s*dx|y')\s*=\s*(.+)$/i;
const EQUALS_ZERO_PATTERN = /^(.+?)\s*=\s*0\s*$/;
const GENERAL_EQUATION_PATTERN = /^(.+?)\s*=\s*(.+)$/;

function containsBothVariables(expr: string): boolean {
	return /\bx\b/.test(expr) && /\by\b/.test(expr);
}

function validatePgfCompatibility(expr: string, mode: PlotMode, odeSolution = false): void {
	if (/y\s*''+/i.test(expr)) {
		if (mode === 'ode' && odeSolution) {
			return;
		}
		throw new GraphSyntaxError(
			'Second-order derivatives (y\'\') are not supported in graph expressions.',
			mode === 'ode'
				? 'Use [ode, solution]{y\'\' = f(x,y,y\')} with x0, y0, yp0 for numerical solutions.'
				: 'Plot an explicit solution instead, e.g. \\function{y = 0.5*\\lambda*x^2}.',
		);
	}

	if (/y\s*'(?![a-zA-Z])/i.test(expr) && mode !== 'ode') {
		throw new GraphSyntaxError(
			'Prime notation y\' is not valid in pgfplots math.',
			'Use [ode]{dy/dx = ...} for slope fields, or give an explicit formula y = ...',
		);
	}

	if (/\\dd(?:x|t|y)\b/i.test(expr)) {
		throw new GraphSyntaxError(
			'Leibniz derivative notation is not supported inside plot math.',
			'Write dy/dx = ... in [ode] mode, or an explicit y = ... formula.',
		);
	}
}

export function normalizeFunctionExpression(
	raw: string,
	mode: PlotMode,
	odeSolution = false,
): NormalizedExpression {
	const body = raw.trim();
	if (!body) {
		throw new GraphSyntaxError('Function body is empty.', 'Enter an expression such as x^2 or y = sin(x).');
	}

	validatePgfCompatibility(body, mode, odeSolution);

	const explicitY = EXPLICIT_Y_PATTERN.exec(body);
	if (explicitY && mode !== 'parametric' && mode !== 'polar') {
		const pgfExpr = explicitY[1].trim();
		validatePgfCompatibility(pgfExpr, mode, odeSolution);
		if (mode === 'ode') {
			throw new GraphSyntaxError(
				'ODE mode expects a slope function, not y = ...',
				'Use \\function[ode]{dy/dx = x + y} or \\function[ode]{x + y}.',
			);
		}
		return { kind: mode === 'pde' || mode === '3d' ? 'surface' : 'explicit', pgfExpr };
	}

	const odeSlope = ODE_SLOPE_PATTERN.exec(body);
	if (odeSlope) {
		const pgfExpr = odeSlope[1].trim();
		validatePgfCompatibility(pgfExpr, 'ode', odeSolution);
		return { kind: 'ode_slope', pgfExpr, forcedMode: 'ode' };
	}

	if (odeSolution && /y\s*''/i.test(body)) {
		return { kind: 'ode_slope', pgfExpr: body, forcedMode: 'ode' };
	}

	const equalsZero = EQUALS_ZERO_PATTERN.exec(body);
	if (equalsZero) {
		if (mode === 'ode') {
			throw new GraphSyntaxError(
				'ODE mode expects dy/dx = f(x,y), not an equation equal to zero.',
				'Example: \\function[ode, domain=-3:3]{x + y}. For y\'\' = 0, plot y = c1*x + c2 explicitly.',
			);
		}
		const pgfExpr = equalsZero[1].trim();
		validatePgfCompatibility(pgfExpr, mode);
		return { kind: 'implicit', pgfExpr };
	}

	const equation = GENERAL_EQUATION_PATTERN.exec(body);
	if (equation) {
		const lhs = equation[1].trim();
		const rhs = equation[2].trim();

		if (mode === 'ode') {
			throw new GraphSyntaxError(
				'ODE mode expects dy/dx = f(x,y), not a general equation.',
				'Example: \\function[ode]{dy/dx = x - y}.',
			);
		}

		if (EXPLICIT_Y_PATTERN.test(body)) {
			return normalizeFunctionExpression(body, mode);
		}

		if (containsBothVariables(`${lhs} ${rhs}`) || mode === 'implicit') {
			const pgfExpr = `(${lhs}) - (${rhs})`;
			validatePgfCompatibility(pgfExpr, mode);
			return { kind: 'implicit', pgfExpr };
		}

		throw new GraphSyntaxError(
			`Could not interpret equation "${body}".`,
			'Use y = f(x), f(x,y) = 0, or [implicit]{x^2 + y^2 = 9}.',
		);
	}

	if (mode === 'ode') {
		return { kind: 'ode_slope', pgfExpr: body };
	}

	if (mode === 'pde' || mode === '3d') {
		return { kind: 'surface', pgfExpr: body };
	}

	if (mode === 'implicit') {
		return { kind: 'implicit', pgfExpr: body };
	}

	if (containsBothVariables(body)) {
		validatePgfCompatibility(body, mode);
		return { kind: 'implicit', pgfExpr: body };
	}

	return { kind: 'explicit', pgfExpr: body };
}

export function resolvePlotMode(options: string, normalized: NormalizedExpression): PlotMode {
	if (normalized.forcedMode) {
		return normalized.forcedMode;
	}
	if (hasOption(options, 'ode')) {
		return 'ode';
	}
	if (hasOption(options, 'implicit')) {
		return 'implicit';
	}
	if (hasOption(options, 'pde')) {
		return 'pde';
	}
	if (hasOption(options, '3d')) {
		return '3d';
	}
	if (hasOption(options, 'parametric')) {
		return 'parametric';
	}
	if (hasOption(options, 'polar')) {
		return 'polar';
	}
	if (normalized.kind === 'implicit') {
		return 'implicit';
	}
	if (normalized.kind === 'ode_slope') {
		return 'ode';
	}
	if (normalized.kind === 'surface') {
		return 'pde';
	}
	return 'standard';
}

function hasOption(options: string, name: string): boolean {
	return new RegExp(`(?:^|,\\s*)${name}(?:\\s*=|\\s*,|$)`).test(options);
}

export function extractGraphParameters(body: string): { parameters: GraphParameter[]; remaining: string } {
	const parameters: GraphParameter[] = [];
	const removals: Array<{ start: number; end: number }> = [];
	let index = 0;

	while (index < body.length) {
		const paramMatch = body.slice(index).match(/\\param\b/);
		if (!paramMatch || paramMatch.index === undefined) {
			break;
		}

		const paramStart = index + paramMatch.index;
		let cursor = paramStart + '\\param'.length;

		while (cursor < body.length && /\s/.test(body[cursor])) {
			cursor++;
		}

		const nameBraces = findBracedArgument(body, cursor);
		if (!nameBraces) {
			index = paramStart + '\\param'.length;
			continue;
		}

		cursor = nameBraces.end;
		while (cursor < body.length && /\s/.test(body[cursor])) {
			cursor++;
		}

		const valueBraces = findBracedArgument(body, cursor);
		if (!valueBraces) {
			index = paramStart + '\\param'.length;
			continue;
		}

		const name = nameBraces.content.trim();
		const value = parseSliderParamValue(valueBraces.content.trim());
		if (name && value) {
			parameters.push({ name, value });
			removals.push({ start: paramStart, end: valueBraces.end });
		}

		index = valueBraces.end;
	}

	let remaining = body;
	for (let i = removals.length - 1; i >= 0; i--) {
		const removal = removals[i];
		remaining = remaining.slice(0, removal.start) + remaining.slice(removal.end);
	}

	return { parameters, remaining: remaining.trim() };
}

function toMacroName(name: string): string {
	const trimmed = name.trim();
	return trimmed.startsWith('\\') ? trimmed : `\\${trimmed}`;
}

function paramBareName(name: string): string {
	const trimmed = name.trim();
	return trimmed.startsWith('\\') ? trimmed.slice(1) : trimmed;
}

const PLOT_RESERVED_NAMES = new Set([
	'x', 'y', 'z', 'r', 't', 'deg', 'sin', 'cos', 'tan', 'exp', 'log', 'sqrt', 'abs', 'pi', 'e',
	'min', 'max', 'mod', 'ln',
]);

export function normalizePgfMath(expr: string): string {
	let result = expr;
	let prev = '';
	while (result !== prev) {
		prev = result;
		result = result.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '(($1)/($2))');
	}

	return result
		.replace(/\\sin\b/g, 'sin')
		.replace(/\\cos\b/g, 'cos')
		.replace(/\\tan\b/g, 'tan')
		.replace(/\\exp\b/g, 'exp')
		.replace(/\\log\b/g, 'log')
		.replace(/\\sqrt\b/g, 'sqrt')
		.replace(/\\abs\b/g, 'abs')
		.replace(/\\pi\b/g, 'pi');
}

export function substituteParameters(expr: string, parameters: GraphParameter[]): string {
	let result = expr;
	const sorted = [...parameters].sort((left, right) => paramBareName(right.name).length - paramBareName(left.name).length);
	const definedParams = new Set(sorted.map(param => paramBareName(param.name).toLowerCase()));

	for (const param of sorted) {
		const bare = paramBareName(param.name);
		if (!bare) {
			continue;
		}
		if (PLOT_RESERVED_NAMES.has(bare.toLowerCase()) && !definedParams.has(bare.toLowerCase())) {
			continue;
		}

		const value = param.value.trim();
		const latexName = toMacroName(param.name);
		const safeName = /^[A-Za-z]$/.test(bare) ? `\\mgparam${bare}` : latexName;

		result = result.replaceAll(latexName, `(${value})`);
		result = result.replaceAll(safeName, `(${value})`);

		if (/^[A-Za-z]+$/.test(bare)) {
			const barePattern = new RegExp(`(?<![\\\\A-Za-z])${bare}(?![A-Za-z])`, 'g');
			result = result.replace(barePattern, `(${value})`);
		}
	}

	return normalizePgfMath(result);
}

export function buildParameterDefs(parameters: GraphParameter[]): string {
	if (parameters.length === 0) {
		return '';
	}

	return parameters
		.map(param => {
			const bare = paramBareName(param.name);
			const macro = /^[A-Za-z]$/.test(bare) ? `\\mgparam${bare}` : toMacroName(param.name);
			return `\\def${macro}{${param.value}}`;
		})
		.join('\n');
}

export interface NumericRange {
	min: number;
	max: number;
}

const AUTO_FIT_SAFE_PATTERN = /^[\d\s+x+\-*/^().,a-zA-Z\\]+$/;

function replaceDegCalls(expr: string, variable: string, value: number): string {
	const pattern = new RegExp(`deg\\s*\\(\\s*${variable}\\s*\\)`, 'gi');
	return expr.replace(pattern, String((value * 180) / Math.PI));
}

function trigReplacements(trigDegrees: boolean): Array<[RegExp, string]> {
	if (trigDegrees) {
		return [
			[/\bsin\b/g, 'sinDeg'],
			[/\bcos\b/g, 'cosDeg'],
			[/\btan\b/g, 'tanDeg'],
		];
	}

	return [
		[/\bsin\b/g, 'Math.sin'],
		[/\bcos\b/g, 'Math.cos'],
		[/\btan\b/g, 'Math.tan'],
	];
}

export function evaluatePlotExpr(expr: string, variable: string, value: number, trigDegrees = false): number | null {
	let jsExpr = normalizePgfMath(expr)
		.replace(/\\pi\b/g, String(Math.PI))
		.replace(/\\lambda\b/g, '1')
		.replace(/\^/g, '**')
		.replace(new RegExp(`\\b${variable}\\b`, 'g'), `(${value})`);

	jsExpr = replaceDegCalls(jsExpr, variable, value);

	if (!AUTO_FIT_SAFE_PATTERN.test(jsExpr)) {
		return null;
	}

	for (const [pattern, replacement] of trigReplacements(trigDegrees)) {
		jsExpr = jsExpr.replace(pattern, replacement);
	}

	jsExpr = jsExpr
		.replace(/\bexp\b/g, 'Math.exp')
		.replace(/\blog\b/g, 'Math.log')
		.replace(/\bsqrt\b/g, 'Math.sqrt')
		.replace(/\babs\b/g, 'Math.abs');

	try {
		const sinDeg = (x: number) => Math.sin((x * Math.PI) / 180);
		const cosDeg = (x: number) => Math.cos((x * Math.PI) / 180);
		const tanDeg = (x: number) => Math.tan((x * Math.PI) / 180);
		const valueFn = Function(
			'sinDeg',
			'cosDeg',
			'tanDeg',
			`"use strict"; return (${jsExpr});`,
		);
		const result = valueFn(sinDeg, cosDeg, tanDeg) as number;
		return Number.isFinite(result) ? result : null;
	} catch {
		return null;
	}
}

function evaluateForAutoFit(expr: string, x: number, trigDegrees = false): number | null {
	return evaluatePlotExpr(expr, 'x', x, trigDegrees);
}

function isNearInteger(value: number, tolerance = 0.01): boolean {
	return Math.abs(value - Math.round(value)) <= tolerance;
}

export function isLikelyDegreeDomain(range: NumericRange): boolean {
	const span = Math.abs(range.max - range.min);
	if (span < 180 || span > 720) {
		return false;
	}

	const min = range.min;
	const max = range.max;
	const nearZeroStart = Math.abs(min) <= 1 || isNearInteger(min % 90);
	const roundEnd = isNearInteger(max) || isNearInteger(max % 90);
	const classicDegreeSpan = Math.abs(span - 360) <= 1 || Math.abs(span - 180) <= 1 || Math.abs(span - 720) <= 1;

	return classicDegreeSpan && nearZeroStart && roundEnd;
}

export function findBracedArgument(text: string, start: number): { content: string; end: number } | null {
	if (text[start] !== '{') {
		return null;
	}

	let depth = 0;
	for (let i = start; i < text.length; i++) {
		const char = text[i];
		if (char === '\\') {
			i++;
			continue;
		}

		if (char === '{') {
			depth++;
		} else if (char === '}') {
			depth--;
			if (depth === 0) {
				return { content: text.slice(start + 1, i), end: i + 1 };
			}
		}
	}

	return null;
}

function padNumericRange(min: number, max: number, ratio = 0.08): NumericRange {
	const span = max - min;
	const pad = span === 0 ? 1 : span * ratio;
	return { min: min - pad, max: max + pad };
}

function sampleRange(range: NumericRange, samples: number): number[] {
	const values: number[] = [];
	for (let i = 0; i <= samples; i++) {
		const t = i / samples;
		values.push(range.min + t * (range.max - range.min));
	}
	return values;
}

export function estimateParametricCartesianRange(
	xExpr: string,
	yExpr: string,
	tRange: NumericRange,
	trigDegrees = false,
	samples = 64,
): { x: NumericRange; y: NumericRange } | null {
	let xmin = Number.POSITIVE_INFINITY;
	let xmax = Number.NEGATIVE_INFINITY;
	let ymin = Number.POSITIVE_INFINITY;
	let ymax = Number.NEGATIVE_INFINITY;
	let valid = 0;

	for (const t of sampleRange(tRange, samples)) {
		const x = evaluatePlotExpr(xExpr, 'x', t, trigDegrees);
		const y = evaluatePlotExpr(yExpr, 'x', t, trigDegrees);
		if (x === null || y === null) {
			continue;
		}
		valid++;
		xmin = Math.min(xmin, x);
		xmax = Math.max(xmax, x);
		ymin = Math.min(ymin, y);
		ymax = Math.max(ymax, y);
	}

	if (valid === 0) {
		return null;
	}

	return {
		x: padNumericRange(xmin, xmax),
		y: padNumericRange(ymin, ymax),
	};
}

export function estimatePolarCartesianRange(
	radiusExpr: string,
	angleExpr: string,
	tRange: NumericRange,
	trigDegrees = false,
	samples = 64,
): { x: NumericRange; y: NumericRange } | null {
	let xmin = Number.POSITIVE_INFINITY;
	let xmax = Number.NEGATIVE_INFINITY;
	let ymin = Number.POSITIVE_INFINITY;
	let ymax = Number.NEGATIVE_INFINITY;
	let valid = 0;

	for (const t of sampleRange(tRange, samples)) {
		const radius = evaluatePlotExpr(radiusExpr, 'x', t, trigDegrees);
		const angle = evaluatePlotExpr(angleExpr, 'x', t, trigDegrees);
		if (radius === null || angle === null) {
			continue;
		}

		const radians = trigDegrees ? (angle * Math.PI) / 180 : angle;
		const x = radius * Math.cos(radians);
		const y = radius * Math.sin(radians);
		valid++;
		xmin = Math.min(xmin, x);
		xmax = Math.max(xmax, x);
		ymin = Math.min(ymin, y);
		ymax = Math.max(ymax, y);
	}

	if (valid === 0) {
		return null;
	}

	return {
		x: padNumericRange(xmin, xmax),
		y: padNumericRange(ymin, ymax),
	};
}

export function estimateExplicitYRange(
	pgfExpr: string,
	xRange: NumericRange,
	trigDegrees = false,
	samples = 48,
): NumericRange | null {
	let ymin = Number.POSITIVE_INFINITY;
	let ymax = Number.NEGATIVE_INFINITY;
	let valid = 0;

	for (let i = 0; i <= samples; i++) {
		const t = i / samples;
		const x = xRange.min + t * (xRange.max - xRange.min);
		const y = evaluatePlotExpr(pgfExpr, 'x', x, trigDegrees);
		if (y === null) {
			continue;
		}
		valid++;
		ymin = Math.min(ymin, y);
		ymax = Math.max(ymax, y);
	}

	if (valid === 0) {
		return null;
	}

	const span = ymax - ymin;
	const pad = span === 0 ? 1 : span * 0.08;
	return { min: ymin - pad, max: ymax + pad };
}

export function splitAxisArgList(sizeArg: string): string[] {
	return sizeArg.split(',').map(part => part.trim()).filter(Boolean);
}

export interface ParsedInequality {
	kind: 'y_below' | 'y_above' | 'implicit';
	expr: string;
	operator: '<' | '<=' | '>' | '>=';
}

export function parseInequality(body: string): ParsedInequality | null {
	const trimmed = body.trim();
	const match = trimmed.match(/^(.+?)\s*(<=|>=|<|>)\s*(.+)$/);
	if (!match) {
		return null;
	}

	const lhs = match[1].trim();
	const operator = match[2] as ParsedInequality['operator'];
	const rhs = match[3].trim();

	const yOnLeft = /^y$/i.test(lhs);
	const yOnRight = /^y$/i.test(rhs);

	if (yOnLeft && !yOnRight) {
		return {
			kind: operator === '<' || operator === '<=' ? 'y_below' : 'y_above',
			expr: rhs,
			operator,
		};
	}

	if (yOnRight && !yOnLeft) {
		return {
			kind: operator === '>' || operator === '>=' ? 'y_below' : 'y_above',
			expr: lhs,
			operator,
		};
	}

	if (/\bx\b/.test(trimmed) && /\by\b/.test(trimmed)) {
		const expr = operator === '<' || operator === '<='
			? `(${lhs}) - (${rhs})`
			: `(${rhs}) - (${lhs})`;
		return { kind: 'implicit', expr, operator };
	}

	return null;
}

export function parseSliderParamValue(raw: string): string {
	const trimmed = raw.trim();
	const slider = /^(-?\d+(?:\.\d+)?)\s*:\s*(-?\d+(?:\.\d+)?)(?:\s*:\s*(-?\d+(?:\.\d+)?))?$/.exec(trimmed);
	if (!slider) {
		return trimmed;
	}

	const min = Number.parseFloat(slider[1]);
	const max = Number.parseFloat(slider[2]);
	const step = slider[3] ? Number.parseFloat(slider[3]) : null;
	if (!Number.isFinite(min) || !Number.isFinite(max)) {
		return trimmed;
	}

	if (step !== null && Number.isFinite(step) && step > 0) {
		const midpoint = min + Math.floor(((max - min) / step) / 2) * step;
		return String(Number.parseFloat(midpoint.toFixed(6)));
	}

	return String((min + max) / 2);
}

export function evaluatePlotExpr2D(
	expr: string,
	x: number,
	y: number,
	trigDegrees = false,
): number | null {
	let jsExpr = normalizePgfMath(expr)
		.replace(/\\pi\b/g, String(Math.PI))
		.replace(/\^/g, '**')
		.replace(/\bx\b/g, `(${x})`)
		.replace(/\by\b/g, `(${y})`);

	if (!/^[\d\s+x+\-*/^().,a-zA-Z\\]+$/.test(jsExpr)) {
		return null;
	}

	for (const [pattern, replacement] of trigReplacements(trigDegrees)) {
		jsExpr = jsExpr.replace(pattern, replacement);
	}

	jsExpr = jsExpr
		.replace(/\bexp\b/g, 'Math.exp')
		.replace(/\blog\b/g, 'Math.log')
		.replace(/\bsqrt\b/g, 'Math.sqrt')
		.replace(/\babs\b/g, 'Math.abs');

	try {
		const sinDeg = (value: number) => Math.sin((value * Math.PI) / 180);
		const cosDeg = (value: number) => Math.cos((value * Math.PI) / 180);
		const tanDeg = (value: number) => Math.tan((value * Math.PI) / 180);
		const valueFn = Function(
			'sinDeg',
			'cosDeg',
			'tanDeg',
			`"use strict"; return (${jsExpr});`,
		);
		const result = valueFn(sinDeg, cosDeg, tanDeg) as number;
		return Number.isFinite(result) ? result : null;
	} catch {
		return null;
	}
}
