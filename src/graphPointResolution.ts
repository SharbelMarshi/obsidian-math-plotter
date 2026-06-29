import { evaluateExpression } from './ExpressionEngine';
import { compileExpressionForPgfplots } from '../graphSyntax';
import { parseBoundToNumber } from './graphRangeValidation';
import { getUserFunction, type GraphPoint, type GraphSpec } from './graphSpec';

export const POINT_ON_GRAPH_TOLERANCE = 1e-6;

export interface GraphPointComputed {
	y?: string;
	z?: string;
}

export type GraphPointStatus =
	| 'ok'
	| 'computed-y'
	| 'computed-z'
	| 'not-on-graph'
	| 'could-not-evaluate'
	| 'incomplete';

export interface GraphPointAnalysis {
	status: GraphPointStatus;
	statusText: string;
	computed?: GraphPointComputed;
}

function expressionContext(spec: GraphSpec) {
	return {
		variables: ['x', 'y', 'z', 't'],
		parameters: spec.parameters ?? {},
	};
}

export function graphUses3dPoints(spec: GraphSpec): boolean {
	if (spec.type === 'surface3d' || spec.type === 'parametric3d') {
		return true;
	}
	if (spec.type === 'pde' && (spec.view ?? '3d') === '3d') {
		return true;
	}
	return false;
}

export function graphSupportsAutoComputeY(spec: GraphSpec): boolean {
	return spec.type === 'function2d'
		|| (spec.type === 'ode' && (spec.view ?? '2d') === '2d');
}

export function graphSupportsAutoComputeZ(spec: GraphSpec): boolean {
	return spec.type === 'surface3d'
		|| (spec.type === 'pde' && (spec.view ?? '3d') === '3d');
}

function substituteVariableLiterals(expression: string, name: string, value: string): string {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const pattern = new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, 'g');
	const wrapped = value.includes(' ') ? `{${value}}` : value;
	return expression.replace(pattern, wrapped);
}

function formatNumericCoordinate(value: number): string {
	if (Number.isInteger(value) || Math.abs(value - Math.round(value)) < 1e-10) {
		return String(Math.round(value));
	}
	return String(Number.parseFloat(value.toPrecision(12)));
}

function expressionBody(spec: GraphSpec): string {
	const fn = getUserFunction(spec).trim();
	return fn.replace(/^y\s*=\s*/i, '').trim();
}

export function evaluateUserExpressionAtPoint(
	spec: GraphSpec,
	variables: { x?: number; y?: number },
): number | null {
	const body = expressionBody(spec);
	if (!body) {
		return null;
	}

	try {
		const scope: Record<string, number> = {};
		if (variables.x !== undefined) {
			scope.x = variables.x;
		}
		if (variables.y !== undefined) {
			scope.y = variables.y;
		}
		return evaluateExpression(body, scope, spec.parameters ?? {}, expressionContext(spec));
	} catch {
		return null;
	}
}

function computeCoordinateExpressionSymbolic(
	spec: GraphSpec,
	coords: { x: string; y?: string },
): string | null {
	const body = expressionBody(spec);
	if (!body) {
		return null;
	}

	try {
		let expr = compileExpressionForPgfplots(body, expressionContext(spec));
		expr = substituteVariableLiterals(expr, 'x', coords.x.trim());
		if (coords.y !== undefined) {
			expr = substituteVariableLiterals(expr, 'y', coords.y.trim());
		}

		const params = spec.parameters ?? {};
		for (const [name, raw] of Object.entries(params)) {
			if (name === 'x' || name === 'y' || name === 'z') {
				continue;
			}
			expr = substituteVariableLiterals(expr, name, raw.trim());
		}

		return expr;
	} catch {
		return null;
	}
}

function pointLabel(point: GraphPoint): string {
	return point.label?.trim() || 'Point';
}

export function analyzeGraphPoint(spec: GraphSpec, point: GraphPoint): GraphPointAnalysis | null {
	const x = point.x?.trim() ?? '';
	if (!x) {
		return null;
	}

	const label = pointLabel(point);

	if (graphSupportsAutoComputeY(spec)) {
		const yProvided = point.y?.trim() ?? '';
		const xNum = parseBoundToNumber(x);
		if (xNum === null) {
			return {
				status: 'could-not-evaluate',
				statusText: `${label} could not be evaluated.`,
			};
		}

		const computedYNum = evaluateUserExpressionAtPoint(spec, { x: xNum });
		if (computedYNum === null) {
			return {
				status: 'could-not-evaluate',
				statusText: `${label} could not be evaluated.`,
			};
		}

		const computedY = formatNumericCoordinate(computedYNum);
		if (!yProvided) {
			return {
				status: 'computed-y',
				statusText: `Computed y = ${computedY}`,
				computed: { y: computedY },
			};
		}

		const yNum = parseBoundToNumber(yProvided);
		if (yNum === null) {
			return {
				status: 'could-not-evaluate',
				statusText: `${label} could not be evaluated.`,
			};
		}

		if (Math.abs(yNum - computedYNum) > POINT_ON_GRAPH_TOLERANCE) {
			return {
				status: 'not-on-graph',
				statusText: 'Not on graph',
			};
		}

		return { status: 'ok', statusText: '' };
	}

	if (graphSupportsAutoComputeZ(spec)) {
		const y = point.y?.trim() ?? '';
		if (!y) {
			return { status: 'incomplete', statusText: '' };
		}

		const xNum = parseBoundToNumber(x);
		const yNum = parseBoundToNumber(y);
		if (xNum === null || yNum === null) {
			return {
				status: 'could-not-evaluate',
				statusText: `${label} could not be evaluated.`,
			};
		}

		const computedZNum = evaluateUserExpressionAtPoint(spec, { x: xNum, y: yNum });
		if (computedZNum === null) {
			return {
				status: 'could-not-evaluate',
				statusText: `${label} could not be evaluated.`,
			};
		}

		const computedZ = formatNumericCoordinate(computedZNum);
		const zProvided = point.z?.trim() ?? '';
		if (!zProvided) {
			return {
				status: 'computed-z',
				statusText: `Computed z = ${computedZ}`,
				computed: { z: computedZ },
			};
		}

		const zNum = parseBoundToNumber(zProvided);
		if (zNum === null) {
			return {
				status: 'could-not-evaluate',
				statusText: `${label} could not be evaluated.`,
			};
		}

		if (Math.abs(zNum - computedZNum) > POINT_ON_GRAPH_TOLERANCE) {
			return {
				status: 'not-on-graph',
				statusText: 'Not on graph',
			};
		}

		return { status: 'ok', statusText: '' };
	}

	const y = point.y?.trim() ?? '';
	if (!y) {
		return { status: 'incomplete', statusText: '' };
	}

	if (graphUses3dPoints(spec)) {
		const z = point.z?.trim() ?? '';
		if (!z) {
			return { status: 'incomplete', statusText: '' };
		}
	}

	return { status: 'ok', statusText: '' };
}

export function summarizeGraphPointWarnings(spec: GraphSpec, points: GraphPoint[] = spec.points ?? []): string | null {
	const offGraph: GraphPoint[] = [];
	const failed: GraphPoint[] = [];

	for (const point of points) {
		const analysis = analyzeGraphPoint(spec, point);
		if (!analysis) {
			continue;
		}
		if (analysis.status === 'not-on-graph') {
			offGraph.push(point);
		} else if (analysis.status === 'could-not-evaluate') {
			failed.push(point);
		}
	}

	if (offGraph.length === 1) {
		const label = pointLabel(offGraph[0]);
		if (graphSupportsAutoComputeZ(spec)) {
			return `${label} does not satisfy z = f(x,y). It will still be rendered.`;
		}
		return `${label} is not on the graph.`;
	}
	if (offGraph.length > 1) {
		return 'Some points are not on the graph.';
	}
	if (failed.length === 1) {
		return `${pointLabel(failed[0])} could not be evaluated.`;
	}
	if (failed.length > 1) {
		return 'Some points could not be evaluated.';
	}
	return null;
}

export function resolveGraphPointCoordinates(
	spec: GraphSpec,
	point: GraphPoint,
): { x: string; y: string; z?: string } | null {
	const x = point.x?.trim() ?? '';
	if (!x) {
		return null;
	}

	if (graphSupportsAutoComputeY(spec)) {
		const yProvided = point.y?.trim() ?? '';
		if (yProvided) {
			return { x, y: yProvided };
		}

		const xNum = parseBoundToNumber(x);
		if (xNum !== null) {
			const yNum = evaluateUserExpressionAtPoint(spec, { x: xNum });
			if (yNum !== null) {
				return { x, y: formatNumericCoordinate(yNum) };
			}
		}

		const symbolic = computeCoordinateExpressionSymbolic(spec, { x });
		if (symbolic) {
			return { x, y: `{${symbolic}}` };
		}
		return null;
	}

	if (graphSupportsAutoComputeZ(spec)) {
		const y = point.y?.trim() ?? '';
		if (!y) {
			return null;
		}

		const zProvided = point.z?.trim() ?? '';
		if (zProvided) {
			return { x, y, z: zProvided };
		}

		const xNum = parseBoundToNumber(x);
		const yNum = parseBoundToNumber(y);
		if (xNum !== null && yNum !== null) {
			const zNum = evaluateUserExpressionAtPoint(spec, { x: xNum, y: yNum });
			if (zNum !== null) {
				return { x, y, z: formatNumericCoordinate(zNum) };
			}
		}

		const symbolic = computeCoordinateExpressionSymbolic(spec, { x, y });
		if (symbolic) {
			return { x, y, z: `{${symbolic}}` };
		}
		return null;
	}

	const y = point.y?.trim() ?? '';
	if (!y) {
		return null;
	}

	if (graphUses3dPoints(spec)) {
		const z = point.z?.trim() ?? '';
		if (!z) {
			return null;
		}
		return { x, y, z };
	}

	return { x, y };
}

export function attachComputedCoordinates(spec: GraphSpec, points: GraphPoint[]): GraphPoint[] {
	return points.map(point => {
		const analysis = analyzeGraphPoint(spec, point);
		if (!analysis?.computed) {
			const next = { ...point };
			delete next.computed;
			return next;
		}
		return {
			...point,
			computed: { ...analysis.computed },
		};
	});
}
