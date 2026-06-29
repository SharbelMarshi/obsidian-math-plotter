import { parseBoundToNumber } from './graphRangeValidation';
import type { GraphSizePreset, GraphSizeSettings, AspectMode } from './graphSize';
import type { GraphSpec } from './graphSpec';

export const ASPECT_MODE_LABELS: Record<AspectMode, string> = {
	auto: 'Auto',
	fixed: 'Fixed',
};

const ASPECT_MIN = 0.45;
const ASPECT_MAX = 3.0;

const PX_BASE_HEIGHT = 420;
const PX_MIN_WIDTH = 420;
const PX_MAX_WIDTH = 900;
const PX_MIN_HEIGHT = 260;
const PX_MAX_HEIGHT = 600;

const CM_MIN_WIDTH = 7;
const CM_MAX_WIDTH = 16;
const CM_MIN_HEIGHT = 5;
const CM_MAX_HEIGHT = 11;

const CM_TO_PX = 38;

const PRESET_2D_WIDTH_CM: Record<Exclude<GraphSizePreset, 'custom'>, number> = {
	small: 8,
	medium: 11,
	large: 15,
	fullWidth: 17,
};

const PRESET_2D_HEIGHT_CM: Record<Exclude<GraphSizePreset, 'custom'>, number> = {
	small: 5,
	medium: 7,
	large: 9,
	fullWidth: 10,
};

/** 2D graph types that use axis-range aspect ratio (not 3D). */
export function graphUses2dAspectRatio(spec: GraphSpec): boolean {
	if (spec.type === 'surface3d' || spec.type === 'parametric3d') {
		return false;
	}
	if (spec.type === 'pde') {
		return spec.view === '2d';
	}
	if (spec.type === 'ode') {
		return (spec.view ?? '2d') === '2d';
	}
	switch (spec.type) {
		case 'function2d':
		case 'parametric2d':
		case 'data':
			return true;
		default:
			return false;
	}
}

export function resolveAspectMode(size?: GraphSizeSettings): AspectMode {
	return size?.aspectMode === 'fixed' ? 'fixed' : 'auto';
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function rangeSpan(range?: [string, string], fallbackSpan = 10): number {
	const a = parseBoundToNumber(range?.[0] ?? '');
	const b = parseBoundToNumber(range?.[1] ?? '');
	if (a === null || b === null) {
		return fallbackSpan;
	}
	return Math.abs(b - a) || 1;
}

/** Clamped xSpan / ySpan from spec axis ranges. */
export function resolveRangeAspectRatio(spec: GraphSpec): number {
	const xSpan = rangeSpan(spec.ranges?.x);
	const ySpan = rangeSpan(spec.ranges?.y);
	return clamp(xSpan / ySpan, ASPECT_MIN, ASPECT_MAX);
}

export function parseCmValue(value: string): number | null {
	const match = value.trim().match(/^([\d.]+)\s*cm$/i);
	if (!match) {
		return null;
	}
	const parsed = Number.parseFloat(match[1]);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function formatCm(value: number): string {
	const rounded = Math.round(value * 100) / 100;
	return `${rounded}cm`;
}

function presetBaseHeightCm(preset: GraphSizePreset, size: GraphSizeSettings): number {
	if (preset === 'custom') {
		return parseCmValue(size.height ?? '') ?? PRESET_2D_HEIGHT_CM.large;
	}
	return PRESET_2D_HEIGHT_CM[preset];
}

function presetScaleFactor(preset: GraphSizePreset): number {
	switch (preset) {
		case 'small':
			return 0.78;
		case 'medium':
			return 0.9;
		case 'large':
			return 1;
		case 'fullWidth':
			return 1.05;
		default:
			return 1;
	}
}

function computeAutoPlotSizeCm(
	baseHeightCm: number,
	aspect: number,
): { widthCm: number; heightCm: number } {
	let heightCm = baseHeightCm;
	let widthCm = heightCm * aspect;

	const fitScale = Math.min(1, CM_MAX_WIDTH / widthCm, CM_MAX_HEIGHT / heightCm);
	heightCm *= fitScale;
	widthCm *= fitScale;

	if (heightCm < CM_MIN_HEIGHT) {
		const grow = CM_MIN_HEIGHT / heightCm;
		heightCm = CM_MIN_HEIGHT;
		widthCm = Math.min(CM_MAX_WIDTH, widthCm * grow);
	}

	if (aspect >= 1 && widthCm < CM_MIN_WIDTH) {
		widthCm = CM_MIN_WIDTH;
		heightCm = Math.min(CM_MAX_HEIGHT, widthCm / aspect);
	}

	return { widthCm, heightCm };
}

/** LaTeX axis width/height for 2D auto-aspect graphs. */
export function resolveAutoLatex2dDimensions(
	spec: GraphSpec,
	size: GraphSizeSettings,
): { width: string; height: string } {
	const aspect = resolveRangeAspectRatio(spec);
	const baseHeightCm = presetBaseHeightCm(size.preset, size);
	const { widthCm, heightCm } = computeAutoPlotSizeCm(baseHeightCm, aspect);
	return { width: formatCm(widthCm), height: formatCm(heightCm) };
}

function resolveFixedPlotDimensionsCm(
	spec: GraphSpec,
	size: GraphSizeSettings,
): { widthCm: number; heightCm: number } {
	if (size.preset === 'custom') {
		return {
			widthCm: parseCmValue(size.width ?? '') ?? 15,
			heightCm: parseCmValue(size.height ?? '') ?? 9,
		};
	}
	if (spec.type === 'surface3d' || spec.type === 'parametric3d' || (spec.type === 'pde' && (spec.view ?? '3d') === '3d')) {
		return { widthCm: 17, heightCm: 11 };
	}
	return {
		widthCm: PRESET_2D_WIDTH_CM[size.preset],
		heightCm: PRESET_2D_HEIGHT_CM[size.preset],
	};
}

/** Fast SVG plot area dimensions in pixels. */
export function resolveFastSvgPlotDimensions(
	spec: GraphSpec,
	size: GraphSizeSettings,
): { plotWidth: number; plotHeight: number } {
	if (!graphUses2dAspectRatio(spec) || resolveAspectMode(size) === 'fixed') {
		const fixed = resolveFixedPlotDimensionsCm(spec, size);
		return {
			plotWidth: Math.round(fixed.widthCm * CM_TO_PX),
			plotHeight: Math.round(fixed.heightCm * CM_TO_PX),
		};
	}

	const aspect = resolveRangeAspectRatio(spec);
	const scale = presetScaleFactor(size.preset);
	const maxW = PX_MAX_WIDTH * scale;
	const maxH = PX_MAX_HEIGHT * scale;
	const minH = PX_MIN_HEIGHT * scale;
	const minW = PX_MIN_WIDTH * scale;
	const baseH = PX_BASE_HEIGHT * scale;

	let height = baseH;
	let width = height * aspect;

	const fitScale = Math.min(1, maxW / width, maxH / height);
	height *= fitScale;
	width *= fitScale;

	if (height < minH) {
		const grow = minH / height;
		height = minH;
		width = Math.min(maxW, width * grow);
	}

	if (aspect >= 1 && width < minW) {
		width = minW;
		height = Math.min(maxH, width / aspect);
	}

	return {
		plotWidth: Math.round(width),
		plotHeight: Math.round(height),
	};
}

/** Suggested tick count from axis span (wider ranges → fewer ticks). */
export function tickTargetForSpan(span: number): number {
	if (span >= 100) {
		return 4;
	}
	if (span >= 40) {
		return 5;
	}
	return 6;
}
