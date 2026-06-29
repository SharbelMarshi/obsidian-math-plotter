import {
	compileExpressionForOctave,
	GraphExpressionSyntaxError,
	type GraphExpressionContext,
} from '../graphSyntax';
import { parseBoundToNumber } from './graphRangeValidation';
import {
	compileSafeMathExpression,
	type MathScope,
	SafeMathSyntaxError,
} from './safeMathEvaluator';

export class ExpressionEvaluationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ExpressionEvaluationError';
	}
}

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

const DEFAULT_VARIABLES = ['x', 'y', 'z', 't', 'r'];

function stripExplicitYPrefix(expression: string): string {
	return expression.replace(/^y\s*=\s*/i, '').trim();
}

function compiledOctaveToSafeEval(compiled: string): string {
	return compiled
		.replace(/\.\^/g, '^')
		.replace(/\.\*/g, '*')
		.replace(/\.\//g, '/');
}

function buildEvaluationScope(
	variables: Record<string, number>,
	parameters: Record<string, string> = {},
): MathScope {
	const scope: MathScope = {
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

function compileEvaluator(
	expression: string,
	context: GraphExpressionContext = {},
): (scope: MathScope) => number {
	const compiled = compileUserExpression(expression, context);
	const normalized = compiledOctaveToSafeEval(compiled);
	const allowedVariables = [
		...(context.variables ?? DEFAULT_VARIABLES),
		...Object.keys(context.parameters ?? {}),
	];
	try {
		return compileSafeMathExpression(normalized, allowedVariables);
	} catch (err) {
		const message = err instanceof SafeMathSyntaxError
			? err.message
			: `Could not parse expression: ${normalized}`;
		throw new ExpressionEvaluationError(message);
	}
}

export function evaluateExpression(
	expression: string,
	variables: Record<string, number>,
	parameters: Record<string, string> = {},
	context?: GraphExpressionContext,
): number {
	const evaluate = compileEvaluator(expression, context);
	const scope = buildEvaluationScope(variables, parameters);
	const result = evaluate(scope);
	if (!Number.isFinite(result)) {
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
		variables: DEFAULT_VARIABLES,
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
	const evaluate = compileEvaluator(body, context);
	const xs = linspace(xMin, xMax, samples);
	const points: SamplePoint2D[] = [];

	for (const x of xs) {
		const scope = buildEvaluationScope({ x }, parameters);
		const y = evaluate(scope);
		if (!Number.isFinite(y)) {
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
	const evaluate = compileEvaluator(body, context);
	const xs = linspace(xMin, xMax, samplesX);
	const ys = linspace(yMin, yMax, samplesY);
	const points: SamplePoint3D[] = [];

	for (const y of ys) {
		for (const x of xs) {
			const scope = buildEvaluationScope({ x, y }, parameters);
			const z = evaluate(scope);
			if (!Number.isFinite(z)) {
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
	const evaluate = compileEvaluator(body, context);
	const xs = linspace(xMin, xMax, samples);
	const points: Array<{ x: number; u: number }> = [];

	for (const x of xs) {
		const scope = buildEvaluationScope({ x, y: yMid }, parameters);
		const u = evaluate(scope);
		if (!Number.isFinite(u)) {
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
