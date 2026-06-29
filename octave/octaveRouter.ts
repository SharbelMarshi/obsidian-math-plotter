import type { MathGraphSettings } from '../src/settings';
import type { GraphSpec } from '../src/graphSpec';

export type OctaveUseCase =
	| 'function2d'
	| 'surface3d'
	| 'ode2d'
	| 'pde2d'
	| 'pde3d'
	| 'implicit2d'
	| 'largeSurface';

const LARGE_SURFACE_THRESHOLD = 60 * 60;

function sampleCount(spec: GraphSpec): number {
	return (spec.samples ?? 35) * (spec.samplesY ?? spec.samples ?? 35);
}

function is3dSurface(spec: GraphSpec): boolean {
	return spec.type === 'surface3d' || (spec.type === 'pde' && (spec.view ?? '3d') === '3d');
}

function isOdePde(spec: GraphSpec): boolean {
	return spec.type === 'ode' || spec.type === 'pde';
}

/**
 * Decide whether Octave should sample this graph numerically.
 * Returns null when the default symbolic LuaLaTeX path should be used.
 */
export function shouldUseOctave(
	spec: GraphSpec,
	settings: MathGraphSettings,
): OctaveUseCase | null {
	if (!settings.enableOctaveEngine) {
		return null;
	}

	if (spec.numericMode && isOdePde(spec)) {
		if (spec.type === 'pde' && (spec.view ?? '3d') === '3d') {
			return 'pde3d';
		}
		if (spec.type === 'pde') {
			return 'pde2d';
		}
		return 'ode2d';
	}

	if (settings.preferOctaveForOdePdeNumeric && isOdePde(spec)) {
		if (spec.type === 'pde' && (spec.view ?? '3d') === '3d') {
			return 'pde3d';
		}
		if (spec.type === 'pde') {
			return 'pde2d';
		}
		return 'ode2d';
	}

	if (settings.preferOctaveFor3dSurfaces && is3dSurface(spec)) {
		return spec.type === 'pde' ? 'pde3d' : 'surface3d';
	}

	if (sampleCount(spec) >= LARGE_SURFACE_THRESHOLD && is3dSurface(spec)) {
		return 'largeSurface';
	}

	if (spec.type === 'function2d' && spec.implicit) {
		return 'implicit2d';
	}

	return null;
}
