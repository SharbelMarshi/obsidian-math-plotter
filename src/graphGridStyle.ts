import type { GraphSpec } from './graphSpec';

/** Whether the graph builder should expose a grid on/off control. */
export function graphSupportsGridToggle(spec: GraphSpec): boolean {
	switch (spec.type) {
		case 'function2d':
		case 'parametric2d':
		case 'data':
			return true;
		case 'ode':
			return (spec.view ?? '2d') === '2d';
		case 'pde':
			return spec.view === '2d';
		case 'surface3d':
		case 'parametric3d':
			return false;
		default:
			return false;
	}
}

/** Missing style.grid is treated as enabled. */
export function gridEnabledForGraph(spec: GraphSpec): boolean {
	if (!graphSupportsGridToggle(spec)) {
		return true;
	}
	return spec.style?.grid !== false;
}

export function gridAxisOption(spec: GraphSpec): string {
	if (!graphSupportsGridToggle(spec)) {
		return 'grid=none';
	}
	return gridEnabledForGraph(spec) ? 'grid=both' : 'grid=none';
}

/** Apply per-graph grid preference to generated axis options. */
export function applyGridStyleToTikz(tikz: string, spec: GraphSpec): string {
	if (!graphSupportsGridToggle(spec)) {
		return tikz;
	}

	const desired = gridAxisOption(spec);
	if (/\bgrid=(?:both|major|none)\b/.test(tikz)) {
		return tikz.replace(/\bgrid=(?:both|major|none)\b/g, desired);
	}

	return tikz.replace(
		/\\begin\{axis\}\[([^\]]*)\]/g,
		(_match, inner: string) => `\\begin{axis}[${desired},${inner}]`,
	);
}
