import { Parser } from 'expr-eval';
import {
	compileExpressionForOctave,
	GraphExpressionSyntaxError,
	type GraphExpressionContext,
} from '../graphSyntax';
import { parseBoundToNumber } from './graphRangeValidation';

export class ExpressionEvaluationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ExpressionEvaluationError';
	}
}

const parser = new Parser();

export interface SamplePoint2D {
	x: number;
	y: number;
	[key: string]: number;
}

export interface SamplePoint3D {
	x: number;
	y: number;
	z: number;
	[key: string]: number;
}

function stripExplicitYPrefix(expression: string): string {
	return expression.replace(/^y\s*=\s*/i, '').trim();
}

function compiledOctaveToExprEval(compiled: string): string {
	return compiled
		.replace(/\.\^/g, '^')
		.replace(/\.\*/g, '*')
		.replace(/\.\//g, '/');
}

function buildEvaluationScope(
	variables: Record<string, number>,
	parameters: Record<string, string> = {},
): Record<string, number> {
	const scope: Record<string, number> = {
		...variables,
		PI: Math.PI,
		pi: Math.PI,
		e: Math.E,
	};

	for (const [name, raw] of Object.entries(parameters)) {
		if (name in variables) {
			continue;
		}
		const numeric = parseBoundToNumber(raw);
		if (numeric !== null) {
			scope[name] = numeric;
		}
	}

	return scope;
}

function parseCompiledExpression(compiled: string) {
	const normalized = compiledOctaveToExprEval(compiled);
	try {
		return parser.parse(normalized);
	} catch {
		throw new ExpressionEvaluationError(
			`Could not parse expression: ${normalized}`,
		);
	}
}

function compileUserExpression(
	expression: string,
	context: GraphExpressionContext = {},
): string {
	try {
		return compileExpressionForOctave(expression, context);
	} catch (err) {
		if (err instanceof GraphExpressionSyntaxError) {
			throw new ExpressionEvaluationError(err.message);
		}
		throw err;
	}
}

export function evaluateExpression(
	expression: string,
	variables: Record<string, number>,
	parameters: Record<string, string> = {},
	context?: GraphExpressionContext,
): number {
	const compiled = compileUserExpression(expression, context);
	const parsed = parseCompiledExpression(compiled);
	const scope = buildEvaluationScope(variables, parameters);
	const result = parsed.evaluate(scope);
	if (typeof result !== 'number' || !Number.isFinite(result)) {
		throw new ExpressionEvaluationError('Expression did not evaluate to a finite number.');
	}
	return result;
}

function linspace(min: number, max: number, count: number): number[] {
	if (count <= 1) {
		return [min];
	}
	const values: number[] = [];
	for (let i = 0; i < count; i++) {
		values.push(min + (max - min) * (i / (count - 1)));
	}
	return values;
}

function defaultContext(): GraphExpressionContext {
	return {
		variables: ['x', 'y', 'z', 't', 'r'],
		parameters: {},
	};
}

export function sampleFunction2D(
	expression: string,
	xMin: number,
	xMax: number,
	samples: number,
	parameters: Record<string, string> = {},
): SamplePoint2D[] {
	const body = stripExplicitYPrefix(expression);
	const context: GraphExpressionContext = {
		...defaultContext(),
		parameters,
	};
	const compiled = compileUserExpression(body, context);
	const parsed = parseCompiledExpression(compiled);
	const xs = linspace(xMin, xMax, samples);
	const points: SamplePoint2D[] = [];

	for (const x of xs) {
		const scope = buildEvaluationScope({ x }, parameters);
		const y = parsed.evaluate(scope);
		if (typeof y !== 'number' || !Number.isFinite(y)) {
			continue;
		}
		points.push({ x, y });
	}

	if (points.length === 0) {
		throw new ExpressionEvaluationError('Could not sample 2D function.');
	}

	return points;
}

export function sampleSurface3D(
	expression: string,
	xMin: number,
	xMax: number,
	yMin: number,
	yMax: number,
	samplesX: number,
	samplesY: number,
	parameters: Record<string, string> = {},
): SamplePoint3D[] {
	const body = stripExplicitYPrefix(expression);
	const context: GraphExpressionContext = {
		...defaultContext(),
		parameters,
	};
	const compiled = compileUserExpression(body, context);
	const parsed = parseCompiledExpression(compiled);
	const xs = linspace(xMin, xMax, samplesX);
	const ys = linspace(yMin, yMax, samplesY);
	const points: SamplePoint3D[] = [];

	for (const y of ys) {
		for (const x of xs) {
			const scope = buildEvaluationScope({ x, y }, parameters);
			const z = parsed.evaluate(scope);
			if (typeof z !== 'number' || !Number.isFinite(z)) {
				continue;
			}
			points.push({ x, y, z });
		}
	}

	if (points.length === 0) {
		throw new ExpressionEvaluationError('Could not sample 3D surface.');
	}

	return points;
}

export function samplePde2D(
	expression: string,
	xMin: number,
	xMax: number,
	yMin: number,
	yMax: number,
	samples: number,
	parameters: Record<string, string> = {},
): Array<{ x: number; u: number }> {
	const yMid = (yMin + yMax) / 2;
	const body = stripExplicitYPrefix(expression);
	const context: GraphExpressionContext = {
		...defaultContext(),
		parameters,
	};
	const compiled = compileUserExpression(body, context);
	const parsed = parseCompiledExpression(compiled);
	const xs = linspace(xMin, xMax, samples);
	const points: Array<{ x: number; u: number }> = [];

	for (const x of xs) {
		const scope = buildEvaluationScope({ x, y: yMid }, parameters);
		const u = parsed.evaluate(scope);
		if (typeof u !== 'number' || !Number.isFinite(u)) {
			continue;
		}
		points.push({ x, u });
	}

	if (points.length === 0) {
		throw new ExpressionEvaluationError('Could not sample PDE slice.');
	}

	return points;
}

export function formatSampleCsv(
	columns: string[],
	rows: ReadonlyArray<Readonly<Record<string, number>>>,
): string {
	const lines = [columns.join(',')];
	for (const row of rows) {
		lines.push(columns.map(column => String(row[column])).join(','));
	}
	return `${lines.join('\n')}\n`;
}
