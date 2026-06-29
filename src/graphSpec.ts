import {
	sanitizeUserExpressionForStorage,
} from '../graphSyntax';
import { defaultGraphSize, hydrateGraphSize, type GraphSizeSettings } from './graphSize';
import type { MathGraphSettings } from './settings';
import {
	FUNCTION_PLACEHOLDER_2D,
	FUNCTION_PLACEHOLDER_3D,
	FUNCTION_PLACEHOLDER_ODE,
	FUNCTION_PLACEHOLDER_PDE,
} from './functionPlaceholders';

export type GraphType =
	| 'function2d'
	| 'surface3d'
	| 'parametric2d'
	| 'parametric3d'
	| 'ode'
	| 'pde'
	| 'data';

export type GraphView = '2d' | '3d';

export interface GraphPoint {
	x: string;
	y: string;
	label?: string;
}

export interface GraphStyle {
	color?: string;
	width?: string;
	fill?: 'under' | 'between' | 'none';
	opacity?: number;
	legend?: string;
}

export interface GraphExportSettings {
	width?: string;
	height?: string;
}

export type GraphRenderEngine = 'auto' | 'symbolic' | 'octave';

export interface GraphSpec {
	version: 1;
	type: GraphType;
	title?: string;
	equation?: string;
	/** User-entered math exactly as typed (Desmos-style). Primary storage field. */
	function?: string;
	/** @internal Legacy alias — read via getUserFunction(). */
	expression?: string;
	/** @internal Legacy alias for ODE/PDE — read via getUserFunction(). */
	solution?: string;
	xExpression?: string;
	yExpression?: string;
	zExpression?: string;
	view?: GraphView;
	parameter?: string;
	parameters?: Record<string, string>;
	ranges?: {
		x?: [string, string];
		y?: [string, string];
		z?: [string, string];
		t?: [string, string];
	};
	labels?: {
		x?: string;
		y?: string;
		z?: string;
	};
	samples?: number;
	samplesY?: number;
	points?: GraphPoint[];
	data?: Array<{ x: string; y: string }>;
	style?: GraphStyle;
	/** Graph axis and display sizing. */
	size?: GraphSizeSettings;
	/** @deprecated Use size — kept for legacy graphs. */
	export?: GraphExportSettings;
	numericMode?: boolean;
	implicit?: boolean;
	renderEngine?: GraphRenderEngine;
}

/** Read the user-facing function string exactly as stored/typed. */
export function getUserFunction(spec: GraphSpec): string {
	if (spec.function?.trim()) {
		return spec.function.trim();
	}
	if (spec.type === 'ode' || spec.type === 'pde') {
		return spec.solution?.trim() ?? '';
	}
	return spec.expression?.trim() ?? '';
}

/** Store user function text without compiling to engine-specific syntax. */
export function setUserFunction(spec: GraphSpec, value: string): void {
	const trimmed = sanitizeUserExpressionForStorage(value);
	spec.function = trimmed;
	if (spec.type === 'ode' || spec.type === 'pde') {
		spec.solution = trimmed;
	} else if (spec.type !== 'parametric2d' && spec.type !== 'parametric3d' && spec.type !== 'data') {
		spec.expression = trimmed;
	}
}

/** Ensure legacy graphs expose a function field and size without compiling. */
export function hydrateGraphSpec(spec: GraphSpec, settings?: Partial<MathGraphSettings>): GraphSpec {
	if (!spec.function?.trim()) {
		const legacy = getUserFunction(spec);
		if (legacy) {
			spec.function = legacy;
		}
	}

	const fn = getUserFunction(spec);
	if (fn) {
		setUserFunction(spec, fn);
	}

	hydrateGraphSize(spec, settings);
	return spec;
}

export const GRAPH_TYPE_LABELS: Record<GraphType, string> = {
	function2d: '2D Function',
	surface3d: '3D Surface',
	parametric2d: 'Parametric 2D',
	parametric3d: 'Parametric 3D',
	ode: 'ODE Solution',
	pde: 'PDE Solution',
	data: 'Data Plot',
};

export function defaultGraphSpec(
	type: GraphType = 'function2d',
	settings?: Partial<MathGraphSettings>,
): GraphSpec {
	const base: GraphSpec = {
		version: 1,
		type,
		title: '',
		ranges: {
			x: ['-5', '5'],
			y: ['-5', '5'],
		},
		labels: { x: 'x', y: 'y' },
		samples: 100,
		samplesY: 35,
		points: [],
		style: {},
		size: defaultGraphSize(settings),
	};

	switch (type) {
		case 'function2d':
			return setUserFunctionOnSpec({ ...base }, FUNCTION_PLACEHOLDER_2D);
		case 'surface3d':
			return setUserFunctionOnSpec({
				...base,
				ranges: { x: ['-pi', 'pi'], y: ['-pi', 'pi'], z: ['-1', '1'] },
				labels: { x: 'x', y: 'y', z: 'z' },
			}, FUNCTION_PLACEHOLDER_3D);
		case 'parametric2d':
			return {
				...base,
				xExpression: 'cos(t)',
				yExpression: 'sin(t)',
				parameter: 't',
				ranges: { t: ['0', '2*pi'] },
			};
		case 'parametric3d':
			return {
				...base,
				xExpression: 'cos(t)',
				yExpression: 'sin(t)',
				zExpression: 't',
				parameter: 't',
				ranges: { t: ['0', '2*pi'] },
				labels: { x: 'x', y: 'y', z: 'z' },
			};
		case 'ode':
			return setUserFunctionOnSpec({
				...base,
				equation: "y' = y",
				view: '2d',
				parameters: {},
			}, FUNCTION_PLACEHOLDER_ODE);
		case 'pde':
			return setUserFunctionOnSpec({
				...base,
				title: '2D Heat Equation',
				equation: 'u_t = u_xx + u_yy',
				view: '3d',
				parameters: { t: '0.25' },
				ranges: { x: ['0', '2*pi'], y: ['0', '2*pi'], z: ['-1', '1'] },
				labels: { x: 'x', y: 'y', z: 'u(x,y,t)' },
				samples: 35,
				samplesY: 35,
			}, FUNCTION_PLACEHOLDER_PDE);
		case 'data':
			return {
				...base,
				data: [
					{ x: '0', y: '0' },
					{ x: '1', y: '1' },
					{ x: '2', y: '4' },
					{ x: '3', y: '9' },
				],
			};
	}
}

export function parseGraphSpec(source: string, settings?: Partial<MathGraphSettings>): GraphSpec {
	const trimmed = source.trim();
	if (!trimmed) {
		throw new Error('Graph block is empty.');
	}

	const parsed = hydrateGraphSpec(JSON.parse(trimmed) as GraphSpec, settings);
	if (parsed.version !== 1) {
		throw new Error(`Unsupported graph version: ${String(parsed.version)}`);
	}
	if (!parsed.type) {
		throw new Error('Graph block is missing "type".');
	}
	return parsed;
}

function setUserFunctionOnSpec(spec: GraphSpec, value: string): GraphSpec {
	setUserFunction(spec, value);
	return spec;
}

/** Serialize user graph data only — never writes compiled engine syntax. */
export function serializeGraphSpec(spec: GraphSpec): string {
	const copy = hydrateGraphSpec(structuredClone(spec));
	const stored: Record<string, unknown> = { ...copy };

	const fn = sanitizeUserExpressionForStorage(getUserFunction(copy));
	if (fn) {
		stored.function = fn;
	}

	// Keep JSON clean: function is canonical for plotted expressions.
	if (stored.function) {
		if (copy.type === 'function2d' || copy.type === 'surface3d') {
			delete stored.expression;
		}
		if (copy.type === 'ode' || copy.type === 'pde') {
			delete stored.solution;
		}
	}

	delete stored.compiledFunction;
	delete stored.compiledExpression;
	delete stored.octaveExpression;
	delete stored.export;

	return JSON.stringify(stored, null, 2);
}
