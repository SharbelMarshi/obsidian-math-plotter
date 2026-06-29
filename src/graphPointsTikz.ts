import { graphUses3dPoints, resolveGraphPointCoordinates } from './graphPointResolution';
import type { GraphSpec } from './graphSpec';

export { graphUses3dPoints } from './graphPointResolution';

const MARK_OPTS = 'only marks, mark=*, mark size=2pt';

export function escapeLatexText(text: string): string {
	return text
		.replace(/\\/g, '\\textbackslash{}')
		.replace(/([#%&_{}])/g, '\\$1')
		.replace(/\$/g, '\\$')
		.replace(/\^/g, '\\textasciicircum{}')
		.replace(/~/g, '\\textasciitilde{}');
}

function buildPointLabelNode(
	coords: { x: string; y: string; z?: string },
	label: string,
	is3d: boolean,
): string {
	const escaped = escapeLatexText(label);
	if (is3d && coords.z !== undefined) {
		return `\\node[anchor=south west] at (axis cs:${coords.x},${coords.y},${coords.z}) {${escaped}};`;
	}
	return `\\node[anchor=south west] at (axis cs:${coords.x},${coords.y}) {${escaped}};`;
}

export function buildGraphPointsTikz(spec: GraphSpec): string {
	const points = spec.points ?? [];
	if (points.length === 0) {
		return '';
	}

	const is3d = graphUses3dPoints(spec);
	const lines: string[] = [];

	for (const point of points) {
		const coords = resolveGraphPointCoordinates(spec, point);
		if (!coords) {
			continue;
		}

		if (is3d && coords.z !== undefined) {
			lines.push(`\\addplot3[${MARK_OPTS}] coordinates {(${coords.x},${coords.y},${coords.z})};`);
		} else if (!is3d) {
			lines.push(`\\addplot[${MARK_OPTS}] coordinates {(${coords.x},${coords.y})};`);
		}

		if (point.label?.trim()) {
			lines.push(buildPointLabelNode(coords, point.label.trim(), is3d));
		}
	}

	return lines.join('\n');
}

export function appendGraphPointsToTikz(tikz: string, spec: GraphSpec): string {
	const pointsTikz = buildGraphPointsTikz(spec);
	if (!pointsTikz) {
		return tikz;
	}

	const marker = '\\end{axis}';
	const index = tikz.lastIndexOf(marker);
	if (index === -1) {
		return `${tikz}\n${pointsTikz}`;
	}

	return `${tikz.slice(0, index)}${pointsTikz}\n${tikz.slice(index)}`;
}

/** @deprecated Point validation is non-blocking; use summarizeGraphPointWarnings in the modal. */
export function validateGraphPoints(_spec: GraphSpec): string | null {
	return null;
}
