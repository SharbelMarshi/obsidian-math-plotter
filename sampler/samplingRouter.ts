import type { GraphSpec } from '../src/graphSpec';

export type JsSamplingUseCase =
	| 'function2d'
	| 'surface3d'
	| 'ode2d'
	| 'pde2d'
	| 'pde3d';

/**
 * Graph types sampled by the bundled JavaScript expression engine.
 * Returns null when the symbolic PGFPlots path should be used instead.
 */
export function shouldUseJsSampling(spec: GraphSpec): JsSamplingUseCase | null {
	switch (spec.type) {
		case 'function2d':
			if (spec.implicit) {
				return null;
			}
			return 'function2d';
		case 'surface3d':
			return 'surface3d';
		case 'ode':
			return 'ode2d';
		case 'pde':
			return (spec.view ?? '3d') === '3d' ? 'pde3d' : 'pde2d';
		default:
			return null;
	}
}
