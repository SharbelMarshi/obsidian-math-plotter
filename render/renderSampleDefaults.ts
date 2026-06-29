import type { RenderMode } from './renderMode';

export const FAST_SAMPLES_2D = 300;
export const FAST_SAMPLES_3D = 35;
export const TIKZJAX_SAMPLES_2D = 120;
export const TIKZJAX_SAMPLES_3D = 25;

export function effectiveSamples2D(spec: { samples?: number }, mode: RenderMode): number {
	const requested = spec.samples ?? 0;
	if (mode === 'svgFast') {
		return Math.min(Math.max(requested || FAST_SAMPLES_2D, FAST_SAMPLES_2D), 400);
	}
	return Math.min(Math.max(requested || TIKZJAX_SAMPLES_2D, 20), TIKZJAX_SAMPLES_2D);
}

export function effectiveSamples3D(
	spec: { samples?: number; samplesY?: number },
	mode: RenderMode,
): { samplesX: number; samplesY: number } {
	if (mode === 'svgFast') {
		const sx = Math.min(Math.max(spec.samples ?? FAST_SAMPLES_3D, FAST_SAMPLES_3D), 50);
		const sy = Math.min(Math.max(spec.samplesY ?? spec.samples ?? FAST_SAMPLES_3D, FAST_SAMPLES_3D), 50);
		return { samplesX: sx, samplesY: sy };
	}
	const sx = Math.min(Math.max(spec.samples ?? TIKZJAX_SAMPLES_3D, 8), TIKZJAX_SAMPLES_3D);
	const sy = Math.min(Math.max(spec.samplesY ?? spec.samples ?? TIKZJAX_SAMPLES_3D, 8), TIKZJAX_SAMPLES_3D);
	return { samplesX: sx, samplesY: sy };
}
