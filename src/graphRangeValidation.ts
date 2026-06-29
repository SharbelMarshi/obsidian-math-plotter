import { evaluateExpression } from './ExpressionEngine';
import type { GraphSpec } from './graphSpec';
import { getUserFunction } from './graphSpec';
import { evaluateSafeMathExpression } from './safeMathEvaluator';

export const SURFACE_Z_CLIP_WARNING =
	'Most of the surface may be clipped by the selected z range.';

const SAMPLE_GRID = 11;
const IN_RANGE_FRACTION_THRESHOLD = 0.5;

export function parseBoundToNumber(raw: string): number | null {
	const trimmed = raw.trim().replace(/π/g, 'pi');
	if (!trimmed) {
		return null;
	}

	if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
		return Number.parseFloat(trimmed);
	}

	const expr = trimmed
		.replace(/\bpi\b/gi, 'pi')
		.replace(/\^/g, '^');

	if (!/^[\d\s+\-*/().a-zA-Z]+$/.test(expr)) {
		return null;
	}

	const value = evaluateSafeMathExpression(expr, {}, []);
	return Number.isFinite(value) ? value : null;
}

function evaluateSurfaceZ(
	expr: string,
	x: number,
	y: number,
	parameters: Record<string, string>,
): number | null {
	try {
		const body = expr.replace(/^y\s*=\s*/i, '').trim();
		return evaluateExpression(body, { x, y }, parameters, {
			variables: ['x', 'y', 'z', 't', 'r'],
			parameters,
		});
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
