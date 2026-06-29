import { compileExpressionForOctave } from '../graphSyntax';
import type { GraphSpec } from '../src/graphSpec';
import { getUserFunction } from '../src/graphSpec';

export const SURFACE_Z_CLIP_WARNING =
	'Most of the surface may be clipped by the selected z range.';

const SAMPLE_GRID = 11;
const IN_RANGE_FRACTION_THRESHOLD = 0.5;

function parseBoundToNumber(raw: string): number | null {
	const trimmed = raw.trim().replace(/π/g, 'pi');
	if (!trimmed) {
		return null;
	}

	if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
		return Number.parseFloat(trimmed);
	}

	const jsExpr = trimmed
		.replace(/\bpi\b/gi, 'Math.PI')
		.replace(/\^/g, '**');

	if (!/^[\d\s+\-*/().MathPI]+$/.test(jsExpr.replace(/Math\.PI/g, ''))) {
		return null;
	}

	try {
		const value = Function(`"use strict"; return (${jsExpr});`)() as number;
		return Number.isFinite(value) ? value : null;
	} catch {
		return null;
	}
}

function evaluateSurfaceZ(
	expr: string,
	x: number,
	y: number,
	parameters: Record<string, string>,
): number | null {
	try {
		const compiled = compileExpressionForOctave(expr, {
			variables: ['x', 'y', 'z', 't', 'r'],
			parameters,
		});
		let jsExpr = compiled
			.replace(/\.\^/g, '**')
			.replace(/\.\*/g, '*')
			.replace(/\.\//g, '/')
			.replace(/\bpi\b/g, 'Math.PI')
			.replace(/\bx\b/g, `(${x})`)
			.replace(/\by\b/g, `(${y})`)
			.replace(/\bexp\b/g, 'Math.exp')
			.replace(/\blog\b/g, 'Math.log')
			.replace(/\bln\b/g, 'Math.log')
			.replace(/\bsqrt\b/g, 'Math.sqrt')
			.replace(/\babs\b/g, 'Math.abs')
			.replace(/\bsin\b/g, 'Math.sin')
			.replace(/\bcos\b/g, 'Math.cos')
			.replace(/\btan\b/g, 'Math.tan')
			.replace(/\bsinh\b/g, 'Math.sinh')
			.replace(/\bcosh\b/g, 'Math.cosh')
			.replace(/\btanh\b/g, 'Math.tanh');

		for (const [name, value] of Object.entries(parameters)) {
			const numeric = parseBoundToNumber(value);
			if (numeric !== null) {
				jsExpr = jsExpr.replace(new RegExp(`\\b${name}\\b`, 'g'), `(${numeric})`);
			}
		}

		const result = Function(`"use strict"; return (${jsExpr});`)() as number;
		return Number.isFinite(result) ? result : null;
	} catch {
		return null;
	}
}

function isSurface3dSpec(spec: GraphSpec): boolean {
	if (spec.type === 'surface3d') {
		return true;
	}
	return spec.type === 'pde' && (spec.view ?? '3d') === '3d';
}

/**
 * Warn when sampled z values over the x/y domain mostly fall outside the selected z range.
 */
export function surfaceZRangeClipWarning(spec: GraphSpec): string | null {
	if (!isSurface3dSpec(spec)) {
		return null;
	}

	const fn = getUserFunction(spec);
	const xRange = spec.ranges?.x;
	const yRange = spec.ranges?.y;
	const zRange = spec.ranges?.z;
	if (!fn || !xRange?.[0] || !xRange?.[1] || !yRange?.[0] || !yRange?.[1] || !zRange?.[0] || !zRange?.[1]) {
		return null;
	}

	const xMin = parseBoundToNumber(xRange[0]);
	const xMax = parseBoundToNumber(xRange[1]);
	const yMin = parseBoundToNumber(yRange[0]);
	const yMax = parseBoundToNumber(yRange[1]);
	const zMin = parseBoundToNumber(zRange[0]);
	const zMax = parseBoundToNumber(zRange[1]);
	if (
		xMin === null || xMax === null
		|| yMin === null || yMax === null
		|| zMin === null || zMax === null
	) {
		return null;
	}

	const parameters = spec.parameters ?? {};
	let inRangeCount = 0;
	let validCount = 0;
	let sampledMin = Number.POSITIVE_INFINITY;
	let sampledMax = Number.NEGATIVE_INFINITY;

	for (let i = 0; i < SAMPLE_GRID; i++) {
		const x = xMin + (xMax - xMin) * (i / (SAMPLE_GRID - 1));
		for (let j = 0; j < SAMPLE_GRID; j++) {
			const y = yMin + (yMax - yMin) * (j / (SAMPLE_GRID - 1));
			const z = evaluateSurfaceZ(fn, x, y, parameters);
			if (z === null) {
				continue;
			}
			validCount++;
			sampledMin = Math.min(sampledMin, z);
			sampledMax = Math.max(sampledMax, z);
			if (z >= zMin && z <= zMax) {
				inRangeCount++;
			}
		}
	}

	if (validCount === 0) {
		return null;
	}

	const inRangeFraction = inRangeCount / validCount;
	if (inRangeFraction >= IN_RANGE_FRACTION_THRESHOLD) {
		return null;
	}

	const estimatedSpan = sampledMax - sampledMin;
	const selectedSpan = zMax - zMin;
	if (estimatedSpan <= 0 || selectedSpan <= 0) {
		return inRangeFraction < IN_RANGE_FRACTION_THRESHOLD ? SURFACE_Z_CLIP_WARNING : null;
	}

	const overlapMin = Math.max(sampledMin, zMin);
	const overlapMax = Math.min(sampledMax, zMax);
	const overlap = Math.max(0, overlapMax - overlapMin);
	if (overlap / estimatedSpan < IN_RANGE_FRACTION_THRESHOLD) {
		return SURFACE_Z_CLIP_WARNING;
	}

	return inRangeFraction < IN_RANGE_FRACTION_THRESHOLD ? SURFACE_Z_CLIP_WARNING : null;
}
