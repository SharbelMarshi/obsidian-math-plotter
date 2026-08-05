import { hydrateGraphStyle, type ColormapName, type SurfaceStyle } from './graphPlotStyle';
import { sanitizeUserExpressionForStorage } from '../graphSyntax';
import { defaultGraphSize, hydrateGraphSize, type GraphSizeSettings } from './graphSize';
import type { MathGraphSettings } from './settings';

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
	y?: string;
	z?: string;
	label?: string;
	/** Show the point's coordinate values below the marker on the graph. */
	showValue?: boolean;
	computed?: {
		y?: string;
		z?: string;
	};
}

export type { ColormapName, SurfaceStyle } from './graphPlotStyle';

export interface GraphStyle {
	color?: string;
	width?: string;
	fill?: 'under' | 'between' | 'none';
	opacity?: number;
	legend?: string;
	/** 3D surfaces — colored (default), wireframe, or solid. */
	surfaceStyle?: SurfaceStyle;
	/** Colormap for colored/solid 3D surfaces. Default heat. */
	colormap?: ColormapName;
	/** 2D graphs only — show background grid lines. Default true when omitted. */
	grid?: boolean;
	/** Axis line thickness in px (preview) / pt (LaTeX render). Default 1.2. */
	axisWidth?: number;
	/** Title and axis-label text size in px. Default 16. */
	labelFontSize?: number;
}

export interface GraphExportSettings {
	width?: string;
	height?: string;
}

/** @deprecated Internal migration only — rendering backend is chosen automatically. */
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
	/** 3D view rotation in degrees (horizontal azimuth, vertical elevation). */
	rotation?: { azimuth?: number; elevation?: number };
	/** @deprecated Not user-configurable — kept for legacy graph JSON only. */
	renderEngine?: GraphRenderEngine;
}

export interface GraphViewRotation {
	azimuth: number;
	elevation: number;
}

/** Matches the pgfplots default view={45}{28}. */
export const DEFAULT_GRAPH_ROTATION: GraphViewRotation = { azimuth: 45, elevation: 28 };

/** Wrap a horizontal rotation into [-180, 180]. */
export function normalizeAzimuthDeg(value: number): number {
	if (!Number.isFinite(value)) {
		return DEFAULT_GRAPH_ROTATION.azimuth;
	}
	let azimuth = Math.round(value) % 360;
	if (azimuth > 180) {
		azimuth -= 360;
	}
	if (azimuth < -180) {
		azimuth += 360;
	}
	return azimuth;
}

/** Clamp a vertical rotation to [0, 90] (0 = side view, 90 = top-down). */
export function clampElevationDeg(value: number): number {
	if (!Number.isFinite(value)) {
		return DEFAULT_GRAPH_ROTATION.elevation;
	}
	return Math.min(90, Math.max(0, Math.round(value)));
}

/** Effective 3D view rotation for a spec, with defaults and clamping applied. */
export function resolveGraphRotation(spec: GraphSpec): GraphViewRotation {
	return {
		azimuth: normalizeAzimuthDeg(spec.rotation?.azimuth ?? DEFAULT_GRAPH_ROTATION.azimuth),
		elevation: clampElevationDeg(spec.rotation?.elevation ?? DEFAULT_GRAPH_ROTATION.elevation),
	};
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

export function resetGraphMathFields(spec: GraphSpec): GraphSpec {
	spec.equation = '';
	spec.function = '';
	spec.expression = '';
	spec.solution = '';
	spec.xExpression = '';
	spec.yExpression = '';
	spec.zExpression = '';
	spec.parameter = spec.type === 'parametric2d' || spec.type === 'parametric3d' ? 't' : spec.parameter;
	spec.parameters = {};
	if (spec.type === 'data') {
		spec.data = [];
	}
	return spec;
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

	hydrateGraphSize(spec);
	hydrateGraphStyle(spec);
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
	const baseStyle = (): GraphSpec['style'] => {
		if (type === 'surface3d') {
			return { surfaceStyle: 'colored', colormap: 'heat', grid: false };
		}
		if (type === 'pde') {
			return { color: 'auto', surfaceStyle: 'colored', colormap: 'heat', grid: false };
		}
		return { color: 'auto', surfaceStyle: 'wireframe', grid: true };
	};

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
		style: baseStyle(),
		size: defaultGraphSize(),
	};

	switch (type) {
		case 'function2d':
			return resetGraphMathFields({
				...base,
				ranges: { x: ['', ''], y: ['', ''] },
			});
		case 'surface3d':
			return resetGraphMathFields({
				...base,
				ranges: { x: ['', ''], y: ['', ''], z: ['', ''] },
				labels: { x: 'x', y: 'y', z: 'z' },
			});
		case 'parametric2d':
			return resetGraphMathFields({
				...base,
				parameter: 't',
				ranges: { t: ['', ''] },
			});
		case 'parametric3d':
			return resetGraphMathFields({
				...base,
				parameter: 't',
				ranges: { t: ['', ''] },
				labels: { x: 'x', y: 'y', z: 'z' },
			});
		case 'ode':
			return resetGraphMathFields({
				...base,
				view: '2d',
				ranges: { x: ['', ''], y: ['', ''] },
			});
		case 'pde':
			return resetGraphMathFields({
				...base,
				style: { color: 'auto', surfaceStyle: 'colored', colormap: 'heat', grid: false },
				view: '3d',
				ranges: { x: ['', ''], y: ['', ''], z: ['', ''] },
				labels: { x: 'x', y: 'y', z: 'u(x,y,t)' },
				samples: 35,
				samplesY: 35,
			});
		case 'data':
			return resetGraphMathFields({
				...base,
			});
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
	delete stored.renderEngine;

	return JSON.stringify(stored, null, 2);
}
