import type { GraphSpec } from '../src/graphSpec';

/** Graph types the built-in fast SVG renderer can draw without TikZJax. */
export function shouldUseFastSvg(spec: GraphSpec): boolean {
	switch (spec.type) {
		case 'function2d':
			return !spec.implicit;
		case 'ode':
			return (spec.view ?? '2d') === '2d';
		case 'surface3d':
			return true;
		case 'pde':
			return true;
		case 'data':
			return (spec.data?.length ?? spec.points?.length ?? 0) > 0;
		case 'parametric2d':
			return Boolean(spec.xExpression?.trim() && spec.yExpression?.trim());
		case 'parametric3d':
			return Boolean(
				spec.xExpression?.trim()
				&& spec.yExpression?.trim()
				&& spec.zExpression?.trim(),
			);
		default:
			return false;
	}
}

export function isFastSvg3dGraph(spec: GraphSpec): boolean {
	if (spec.type === 'surface3d' || spec.type === 'parametric3d') {
		return true;
	}
	return spec.type === 'pde' && (spec.view ?? '3d') === '3d';
}
