import {
	FUNCTION_PLACEHOLDER_2D,
	FUNCTION_PLACEHOLDER_3D,
	FUNCTION_PLACEHOLDER_ODE,
	FUNCTION_PLACEHOLDER_PDE,
} from './functionPlaceholders';
import { inlinePresetToGraphSize, type InlineSizePreset } from './graphSize';
import { gridEnabledForGraph } from './graphGridStyle';
import { getUserFunction, setUserFunction, type GraphSpec } from './graphSpec';

/** Graph types exposed in the compact inline builder. */
export type InlineGraphType = 'function2d' | 'surface3d' | 'ode' | 'pde';

export const INLINE_GRAPH_TYPE_LABELS: Record<InlineGraphType, string> = {
	function2d: '2D Function',
	surface3d: '3D Surface',
	ode: 'ODE Solution',
	pde: 'PDE Solution',
};

export interface InlineBuilderFields {
	type: InlineGraphType;
	sizePreset: InlineSizePreset;
	expression: string;
	title: string;
	xMin: string;
	xMax: string;
	yMin: string;
	yMax: string;
	zMin: string;
	zMax: string;
	paramT: string;
	grid: boolean;
}

export function inlineFieldsFromSpec(spec: GraphSpec): InlineBuilderFields {
	const type = inlineTypeFromSpec(spec);
	const preset = spec.size?.preset;
	const sizePreset: InlineSizePreset =
		preset === 'medium' || preset === 'fullWidth' ? preset : 'large';

	return {
		type,
		sizePreset,
		expression: getUserFunction(spec),
		title: spec.title ?? '',
		xMin: spec.ranges?.x?.[0] ?? '',
		xMax: spec.ranges?.x?.[1] ?? '',
		yMin: spec.ranges?.y?.[0] ?? '',
		yMax: spec.ranges?.y?.[1] ?? '',
		zMin: spec.ranges?.z?.[0] ?? '',
		zMax: spec.ranges?.z?.[1] ?? '',
		paramT: spec.parameters?.t ?? '',
		grid: gridEnabledForGraph(spec),
	};
}

export function inlineTypeFromSpec(spec: GraphSpec): InlineGraphType {
	if (spec.type === 'surface3d') return 'surface3d';
	if (spec.type === 'ode') return 'ode';
	if (spec.type === 'pde') return 'pde';
	return 'function2d';
}

export function defaultInlineFields(type: InlineGraphType = 'function2d'): InlineBuilderFields {
	switch (type) {
		case 'function2d':
			return {
				type,
				sizePreset: 'large',
				expression: FUNCTION_PLACEHOLDER_2D,
				title: 'Function Graph',
				xMin: '-2*pi',
				xMax: '2*pi',
				yMin: '-1.5',
				yMax: '1.5',
				zMin: '',
				zMax: '',
				paramT: '',
				grid: true,
			};
		case 'surface3d':
			return {
				type,
				sizePreset: 'large',
				expression: FUNCTION_PLACEHOLDER_3D,
				title: '3D Surface',
				xMin: '-pi',
				xMax: 'pi',
				yMin: '-pi',
				yMax: 'pi',
				zMin: '-1',
				zMax: '1',
				paramT: '',
				grid: true,
			};
		case 'ode':
			return {
				type,
				sizePreset: 'large',
				expression: FUNCTION_PLACEHOLDER_ODE,
				title: 'ODE Solution',
				xMin: '-2',
				xMax: '2',
				yMin: '-1',
				yMax: '5',
				zMin: '',
				zMax: '',
				paramT: '',
				grid: true,
			};
		case 'pde':
			return {
				type,
				sizePreset: 'large',
				expression: FUNCTION_PLACEHOLDER_PDE,
				title: 'PDE Solution Surface',
				xMin: '0',
				xMax: '2*pi',
				yMin: '0',
				yMax: '2*pi',
				zMin: '-1',
				zMax: '1',
				paramT: '0.25',
				grid: true,
			};
	}
}

export function specFromInlineFields(fields: InlineBuilderFields): GraphSpec {
	const base: GraphSpec = {
		version: 1,
		type: fields.type,
		title: fields.title.trim() || undefined,
		ranges: {
			x: [fields.xMin.trim(), fields.xMax.trim()],
			y: [fields.yMin.trim(), fields.yMax.trim()],
		},
		labels: { x: 'x', y: 'y' },
		samples: fields.type === 'function2d' || fields.type === 'ode' ? 100 : 35,
		samplesY: 35,
		points: [],
		style: {},
		size: inlinePresetToGraphSize(fields.sizePreset),
	};

	switch (fields.type) {
		case 'function2d':
			setUserFunction(base, fields.expression);
			if (!fields.grid) {
				base.style = { ...(base.style ?? {}), grid: false };
			}
			return base;
		case 'surface3d':
			setUserFunction(base, fields.expression);
			return {
				...base,
				ranges: {
					...base.ranges,
					z: [fields.zMin.trim(), fields.zMax.trim()],
				},
				labels: { x: 'x', y: 'y', z: 'z' },
			};
		case 'ode':
			setUserFunction(base, fields.expression);
			return {
				...base,
				view: '2d',
				parameters: {},
			};
		case 'pde':
			setUserFunction(base, fields.expression);
			return {
				...base,
				type: 'pde',
				equation: 'u_t = u_xx + u_yy',
				view: '3d',
				parameters: fields.paramT.trim() ? { t: fields.paramT.trim() } : {},
				ranges: {
					x: [fields.xMin.trim(), fields.xMax.trim()],
					y: [fields.yMin.trim(), fields.yMax.trim()],
					z: [fields.zMin.trim(), fields.zMax.trim()],
				},
				labels: { x: 'x', y: 'y', z: 'u(x,y,t)' },
			};
	}
}

export function validateInlineFields(fields: InlineBuilderFields): string | null {
	if (!fields.type) {
		return 'Select a graph type.';
	}
	if (!fields.expression.trim()) {
		return 'Enter a function or solution.';
	}
	if (!fields.xMin.trim() || !fields.xMax.trim()) {
		return 'Enter a valid x range.';
	}
	if (fields.type === 'function2d' || fields.type === 'ode') {
		if (!fields.yMin.trim() || !fields.yMax.trim()) {
			return 'Enter a valid y range.';
		}
	}
	if (fields.type === 'surface3d' || fields.type === 'pde') {
		if (!fields.yMin.trim() || !fields.yMax.trim()) {
			return 'Enter a valid y range.';
		}
		if (!fields.zMin.trim() || !fields.zMax.trim()) {
			return 'Enter a valid z range.';
		}
	}
	if (fields.type === 'pde' && !fields.paramT.trim()) {
		return 'Enter a value for parameter t.';
	}
	return null;
}
