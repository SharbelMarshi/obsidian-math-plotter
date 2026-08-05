/**
 * Per-graph axis/label style resolution, shared by the fast SVG renderer and the
 * pgfplots axis builders. Values live on spec.style and fall back to defaults.
 */
import type { GraphSpec } from './graphSpec';

export const DEFAULT_AXIS_LINE_WIDTH = 1.2;
export const AXIS_LINE_WIDTH_MIN = 0.5;
export const AXIS_LINE_WIDTH_MAX = 4;

export const DEFAULT_LABEL_FONT_SIZE = 16;
export const LABEL_FONT_SIZE_MIN = 8;
export const LABEL_FONT_SIZE_MAX = 32;

export function clampAxisLineWidth(width: number): number {
	if (!Number.isFinite(width)) {
		return DEFAULT_AXIS_LINE_WIDTH;
	}
	return Math.min(AXIS_LINE_WIDTH_MAX, Math.max(AXIS_LINE_WIDTH_MIN, width));
}

export function clampLabelFontSize(size: number): number {
	if (!Number.isFinite(size)) {
		return DEFAULT_LABEL_FONT_SIZE;
	}
	return Math.min(LABEL_FONT_SIZE_MAX, Math.max(LABEL_FONT_SIZE_MIN, Math.round(size)));
}

/** Axis line thickness for a graph in px (fast preview) / pt (LaTeX render). */
export function resolveAxisLineWidth(spec?: GraphSpec): number {
	return clampAxisLineWidth(spec?.style?.axisWidth ?? DEFAULT_AXIS_LINE_WIDTH);
}

/** Title and axis-label size for a graph in px. */
export function resolveLabelFontSize(spec?: GraphSpec): number {
	return clampLabelFontSize(spec?.style?.labelFontSize ?? DEFAULT_LABEL_FONT_SIZE);
}

/** Closest LaTeX font-size command for a label size in px. */
export function latexLabelFontCommand(size: number): string {
	if (size <= 10) {
		return '\\small';
	}
	if (size <= 13) {
		return '\\normalsize';
	}
	if (size <= 16) {
		return '\\large';
	}
	if (size <= 20) {
		return '\\Large';
	}
	if (size <= 25) {
		return '\\LARGE';
	}
	return '\\huge';
}
