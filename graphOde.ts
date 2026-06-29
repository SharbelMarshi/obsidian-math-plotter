import { normalizePgfMath, type NumericRange } from './graphExpression';
import { compileSafeMathExpression } from './src/safeMathEvaluator';

export type OdeKind = 'first_order_slope' | 'first_order_solution' | 'second_order_solution';

export interface ParsedOde {
	kind: OdeKind;
	slopeExpr?: string;
	rhsExpr?: string;
}

export interface OdeInitialConditions {
	x0: number;
	y0: number;
	yp0?: number;
}

const FIRST_ORDER_SLOPE = /^(?:dy\s*\/\s*dx|y')\s*=\s*(.+)$/i;
const SECOND_ORDER_EXPLICIT = /^y\s*''\s*=\s*(.+)$/i;

function containsSecondDerivative(expr: string): boolean {
	return /y\s*''/i.test(expr);
}

function equationToSecondOrderRhs(body: string): string | null {
	const trimmed = body.trim();
	const explicit = SECOND_ORDER_EXPLICIT.exec(trimmed);
	if (explicit) {
		return explicit[1].trim();
	}

	const eq = /^(.+?)\s*=\s*(.+)$/.exec(trimmed);
	if (!eq) {
		return null;
	}

	const combined = `(${eq[1].trim()}) - (${eq[2].trim()})`;
	if (!containsSecondDerivative(combined)) {
		return null;
	}

	const withoutYpp = combined.replace(/y\s*''/gi, '');
	const rest = withoutYpp
		.replace(/^\s*\+\s*/, '')
		.replace(/\s*\+\s*$/, '')
		.trim();

	if (!rest || rest === '0') {
		return '0';
	}

	if (rest.startsWith('-')) {
		return rest.slice(1).trim();
	}

	return `-(${rest})`;
}

export function parseOdeExpression(body: string, solutionMode: boolean): ParsedOde {
	const trimmed = body.trim();
	if (!trimmed) {
		throw new Error('ODE expression is empty.');
	}

	const firstOrderSlope = FIRST_ORDER_SLOPE.exec(trimmed);
	if (firstOrderSlope && !containsSecondDerivative(trimmed)) {
		const slopeExpr = firstOrderSlope[1].trim();
		return {
			kind: solutionMode ? 'first_order_solution' : 'first_order_slope',
			slopeExpr,
			rhsExpr: slopeExpr,
		};
	}

	if (containsSecondDerivative(trimmed)) {
		const rhs = equationToSecondOrderRhs(trimmed);
		if (!rhs) {
			throw new Error(`Could not parse second-order ODE "${trimmed}".`);
		}
		return {
			kind: 'second_order_solution',
			rhsExpr: rhs,
		};
	}

	if (solutionMode) {
		return {
			kind: 'first_order_solution',
			slopeExpr: trimmed,
			rhsExpr: trimmed,
		};
	}

	return {
		kind: 'first_order_slope',
		slopeExpr: trimmed,
		rhsExpr: trimmed,
	};
}

function prepareSafeOdeExpr(expr: string): string {
	return normalizePgfMath(expr)
		.replace(/y\s*''/gi, '0')
		.replace(/y\s*'(?![a-zA-Z])/gi, 'yp')
		.replace(/\^/g, '^');
}

function compileFirstOrderRhs(expr: string): (x: number, y: number) => number {
	const normalized = prepareSafeOdeExpr(expr);
	const evaluate = compileSafeMathExpression(normalized, ['x', 'y', 'yp']);
	return (x, y) => {
		const result = evaluate({ x, y, yp: 0 });
		return Number.isFinite(result) ? result : Number.NaN;
	};
}

function compileSecondOrderRhs(expr: string): (x: number, y: number, yp: number) => number {
	const normalized = prepareSafeOdeExpr(expr);
	const evaluate = compileSafeMathExpression(normalized, ['x', 'y', 'yp']);
	return (x, y, ypVal) => {
		const result = evaluate({ x, y, yp: ypVal });
		return Number.isFinite(result) ? result : Number.NaN;
	};
}

function sampleRange(range: NumericRange, steps: number): number[] {
	const values: number[] = [];
	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		values.push(range.min + t * (range.max - range.min));
	}
	return values;
}

export function solveFirstOrderOde(
	rhsExpr: string,
	ic: OdeInitialConditions,
	xRange: NumericRange,
	steps = 200,
): Array<[number, number]> {
	const rhs = compileFirstOrderRhs(rhsExpr);
	const points: Array<[number, number]> = [];
	const xs = sampleRange(xRange, steps);
	let x = ic.x0;
	let y = ic.y0;
	points.push([x, y]);

	for (let i = 1; i < xs.length; i++) {
		const targetX = xs[i];
		let h = targetX - x;
		if (h === 0) {
			continue;
		}

		const k1 = rhs(x, y);
		const k2 = rhs(x + h / 2, y + (h * k1) / 2);
		const k3 = rhs(x + h / 2, y + (h * k2) / 2);
		const k4 = rhs(x + h, y + h * k3);
		y += (h * (k1 + 2 * k2 + 2 * k3 + k4)) / 6;
		x = targetX;
		if (Number.isFinite(y)) {
			points.push([x, y]);
		}
	}

	return points;
}

export function solveSecondOrderOde(
	rhsExpr: string,
	ic: OdeInitialConditions,
	xRange: NumericRange,
	steps = 200,
): Array<[number, number]> {
	const rhs = compileSecondOrderRhs(rhsExpr);
	const yp0 = ic.yp0 ?? 0;
	const points: Array<[number, number]> = [];
	const xs = sampleRange(xRange, steps);
	let x = ic.x0;
	let y = ic.y0;
	let yp = yp0;
	points.push([x, y]);

	for (let i = 1; i < xs.length; i++) {
		const targetX = xs[i];
		const h = targetX - x;
		if (h === 0) {
			continue;
		}

		const deriv = (stateX: number, stateY: number, stateYp: number) => [stateYp, rhs(stateX, stateY, stateYp)] as const;

		const [k1y, k1yp] = deriv(x, y, yp);
		const [k2y, k2yp] = deriv(x + h / 2, y + (h * k1y) / 2, yp + (h * k1yp) / 2);
		const [k3y, k3yp] = deriv(x + h / 2, y + (h * k2y) / 2, yp + (h * k2yp) / 2);
		const [k4y, k4yp] = deriv(x + h, y + h * k3y, yp + h * k3yp);

		y += (h * (k1y + 2 * k2y + 2 * k3y + k4y)) / 6;
		yp += (h * (k1yp + 2 * k2yp + 2 * k3yp + k4yp)) / 6;
		x = targetX;
		if (Number.isFinite(y) && Number.isFinite(yp)) {
			points.push([x, y]);
		}
	}

	return points;
}

export function formatOdeCoordinates(points: Array<[number, number]>): string {
	return points.map(([x, y]) => `(${formatNum(x)}, ${formatNum(y)})`).join(' ');
}

function formatNum(value: number): string {
	if (Math.abs(value) < 1e-10) {
		return '0';
	}
	return Number.parseFloat(value.toFixed(6)).toString();
}

export function extractOdeInitialConditions(options: string): OdeInitialConditions {
	const x0 = parseOptionNumber(options, 'x0') ?? 0;
	const y0 = parseOptionNumber(options, 'y0') ?? 0;
	const yp0 = parseOptionNumber(options, 'yp0') ?? parseOptionNumber(options, "y'0");
	return { x0, y0, yp0: yp0 ?? undefined };
}

function parseOptionNumber(options: string, name: string): number | null {
	const match = options.match(new RegExp(`(?:^|,\\s*)${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`));
	if (!match) {
		return null;
	}
	const parsed = Number.parseFloat(match[1]);
	return Number.isFinite(parsed) ? parsed : null;
}

export function hasOdeSolutionFlag(options: string): boolean {
	return /(?:^|,\s*)(?:solution|odesol)(?:\s*=|\s*,|$)/.test(options);
}
