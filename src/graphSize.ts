import type { GraphSpec, GraphExportSettings } from './graphSpec';
import {
	graphUses2dAspectRatio,
	resolveAspectMode,
	resolveAutoLatex2dDimensions,
} from './graphAspectLayout';

export type GraphSizePreset = 'small' | 'medium' | 'large' | 'fullWidth' | 'custom';

export type AspectMode = 'auto' | 'fixed';

export type InlineSizePreset = 'medium' | 'large' | 'fullWidth';

export interface GraphSizeSettings {
	/** LaTeX/PGFPlots axis size preset. Affects render quality, labels, and export. */
	preset: GraphSizePreset;
	/** LaTeX axis width (custom preset). Used by PGFPlots only. */
	width?: string;
	/** LaTeX axis height (custom preset). Used by PGFPlots only. */
	height?: string;
	/** Visual zoom in Obsidian Reading View. CSS only — no LaTeX recompile. */
	displayScale?: number;
	/** 2D plot shape from axis ranges (auto) or preset dimensions (fixed). */
	aspectMode?: AspectMode;
}

export const GRAPH_SIZE_PRESET_LABELS: Record<GraphSizePreset, string> = {
	small: 'Small',
	medium: 'Medium',
	large: 'Large',
	fullWidth: 'Full width',
	custom: 'Custom',
};

export const INLINE_SIZE_PRESET_LABELS: Record<InlineSizePreset, string> = {
	medium: 'Medium',
	large: 'Large',
	fullWidth: 'Full width',
};

export const GRAPH_PRESET_2D: Record<Exclude<GraphSizePreset, 'custom'>, { width: string; height: string }> = {
	small: { width: '8cm', height: '5cm' },
	medium: { width: '11cm', height: '7cm' },
	large: { width: '15cm', height: '9cm' },
	fullWidth: { width: '17cm', height: '10cm' },
};

const PRESET_2D = GRAPH_PRESET_2D;

const PRESET_3D_HEIGHT: Record<Exclude<GraphSizePreset, 'custom'>, string> = {
	small: '8cm',
	medium: '9cm',
	large: '11cm',
	fullWidth: '11cm',
};

const PRESET_3D_WIDTH: Record<Exclude<GraphSizePreset, 'custom'>, string> = {
	small: '12cm',
	medium: '14cm',
	large: '17cm',
	fullWidth: '17cm',
};

const DIMENSION_PATTERN =
	/^(\d+(?:\.\d+)?(?:cm|mm|in|pt|em|ex)|(?:\d+(?:\.\d+)?)?\\linewidth)$/i;

export const DISPLAY_SCALE_MIN = 0.5;
export const DISPLAY_SCALE_MAX = 2.5;
export const DISPLAY_SCALE_STEP = 0.1;

export function clampDisplayScale(scale: number): number {
	const clamped = Math.max(DISPLAY_SCALE_MIN, Math.min(DISPLAY_SCALE_MAX, scale));
	return Math.round(clamped * 10) / 10;
}

export function isGraph3dView(spec: GraphSpec): boolean {
	if (spec.type === 'surface3d' || spec.type === 'parametric3d') {
		return true;
	}
	if (spec.type === 'pde') {
		return (spec.view ?? '3d') === '3d';
	}
	return false;
}

const DEFAULT_SIZE_PRESET: GraphSizePreset = 'large';
const DEFAULT_2D_WIDTH = '15cm';
const DEFAULT_2D_HEIGHT = '9cm';
const DEFAULT_3D_WIDTH = '17cm';
const DEFAULT_3D_HEIGHT = '11cm';

export function defaultGraphSize(): GraphSizeSettings {
	return {
		preset: DEFAULT_SIZE_PRESET,
		width: DEFAULT_2D_WIDTH,
		height: DEFAULT_2D_HEIGHT,
		displayScale: 1,
		aspectMode: 'auto',
	};
}

export function defaultGraphSizeForSpec(spec: GraphSpec): GraphSizeSettings {
	const base = defaultGraphSize();
	if (!isGraph3dView(spec)) {
		return base;
	}

	const preset = base.preset;
	if (preset !== 'custom') {
		return {
			...base,
			width: PRESET_3D_WIDTH[preset],
			height: PRESET_3D_HEIGHT[preset],
		};
	}

	return {
		...base,
		width: DEFAULT_3D_WIDTH,
		height: DEFAULT_3D_HEIGHT,
	};
}

function isGraphExportSettings(value: unknown): value is GraphExportSettings {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const record = value as Record<string, unknown>;
	const hasWidth = typeof record.width === 'string' && record.width.length > 0;
	const hasHeight = typeof record.height === 'string' && record.height.length > 0;
	return hasWidth || hasHeight;
}

/** Read legacy `export` width/height from older graph blocks. */
function readLegacyExportSize(spec: GraphSpec): GraphSizeSettings | undefined {
	const legacyExport = (spec as unknown as Record<string, unknown>).export;
	if (!isGraphExportSettings(legacyExport)) {
		return undefined;
	}
	return {
		preset: 'custom',
		width: legacyExport.width ?? DEFAULT_2D_WIDTH,
		height: legacyExport.height ?? DEFAULT_2D_HEIGHT,
		displayScale: 1,
		aspectMode: 'auto',
	};
}

export function ensureGraphSize(spec: GraphSpec): GraphSizeSettings {
	if (spec.size?.preset) {
		return {
			preset: spec.size.preset,
			width: spec.size.width,
			height: spec.size.height,
			displayScale: clampDisplayScale(spec.size.displayScale ?? 1),
			aspectMode: spec.size.aspectMode === 'fixed' ? 'fixed' : 'auto',
		};
	}

	const legacySize = readLegacyExportSize(spec);
	if (legacySize) {
		return legacySize;
	}

	return defaultGraphSizeForSpec(spec);
}

export function hydrateGraphSize(spec: GraphSpec): GraphSpec {
	spec.size = ensureGraphSize(spec);
	return spec;
}

function resolveFixedLatexGraphDimensions(spec: GraphSpec): { width: string; height: string } {
	const size = ensureGraphSize(spec);
	const is3d = isGraph3dView(spec);

	if (size.preset === 'custom') {
		const width = size.width?.trim() || (is3d ? DEFAULT_3D_WIDTH : DEFAULT_2D_WIDTH);
		const height = size.height?.trim() || (is3d ? DEFAULT_3D_HEIGHT : DEFAULT_2D_HEIGHT);
		return { width, height };
	}

	const presetDims = PRESET_2D[size.preset];
	return {
		width: is3d ? PRESET_3D_WIDTH[size.preset] : presetDims.width,
		height: is3d ? PRESET_3D_HEIGHT[size.preset] : presetDims.height,
	};
}

export function resolveLatexGraphDimensions(spec: GraphSpec): { width: string; height: string } {
	const size = ensureGraphSize(spec);

	if (graphUses2dAspectRatio(spec) && resolveAspectMode(size) === 'auto') {
		return resolveAutoLatex2dDimensions(spec, size);
	}

	return resolveFixedLatexGraphDimensions(spec);
}

/** @deprecated Use resolveLatexGraphDimensions */
export function resolveGraphDimensions(spec: GraphSpec): { width: string; height: string } {
	return resolveLatexGraphDimensions(spec);
}

/** CSS display zoom for Reading View (does not affect LaTeX output). */
export function resolveDisplayScale(spec: GraphSpec): number {
	return clampDisplayScale(ensureGraphSize(spec).displayScale ?? 1);
}

/** CSS classes for on-screen display layout (separate from LaTeX axis size). */
export function graphDisplayCssClasses(spec: GraphSpec): string {
	const size = ensureGraphSize(spec);
	const classes = ['mathgraph-display-scaled'];
	if (size.preset === 'fullWidth') {
		classes.push('mathgraph-display-full-width');
	}
	return classes.join(' ');
}

/** @deprecated Use graphDisplayCssClasses — LaTeX preset must not drive display width. */
export function graphSizeCssClass(preset: GraphSizePreset): string {
	if (preset === 'fullWidth') {
		return 'mathgraph-display-full-width';
	}
	return 'mathgraph-display-scaled';
}

export function applyPresetToGraphSize(
	preset: GraphSizePreset,
	current?: GraphSizeSettings,
	spec?: GraphSpec,
): GraphSizeSettings {
	const is3d = spec ? isGraph3dView(spec) : false;

	if (preset === 'custom') {
		const base = current ?? defaultGraphSize();
		return {
			preset: 'custom',
			width: base.width ?? (is3d ? DEFAULT_3D_WIDTH : DEFAULT_2D_WIDTH),
			height: base.height ?? (is3d ? DEFAULT_3D_HEIGHT : DEFAULT_2D_HEIGHT),
			displayScale: clampDisplayScale(base.displayScale ?? 1),
			aspectMode: base.aspectMode ?? 'auto',
		};
	}

	return {
		preset,
		width: is3d ? PRESET_3D_WIDTH[preset] : PRESET_2D[preset].width,
		height: is3d ? PRESET_3D_HEIGHT[preset] : PRESET_2D[preset].height,
		displayScale: clampDisplayScale(current?.displayScale ?? 1),
		aspectMode: current?.aspectMode ?? 'auto',
	};
}

export function inlinePresetToGraphSize(preset: InlineSizePreset): GraphSizeSettings {
	return applyPresetToGraphSize(preset);
}

export function validateDimension(value: string, label: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) {
		return `${label} is required.`;
	}
	if (!DIMENSION_PATTERN.test(trimmed)) {
		return `${label} must be a value like 10cm, 14cm, or 0.9\\linewidth.`;
	}
	return null;
}

export function validateGraphSize(size: GraphSizeSettings): string | null {
	const scale = size.displayScale ?? 1;
	if (scale < DISPLAY_SCALE_MIN || scale > DISPLAY_SCALE_MAX) {
		return `Display scale must be between ${DISPLAY_SCALE_MIN} and ${DISPLAY_SCALE_MAX}.`;
	}

	if (size.preset === 'custom') {
		const widthError = validateDimension(size.width ?? '', 'Width');
		if (widthError) {
			return widthError;
		}
		const heightError = validateDimension(size.height ?? '', 'Height');
		if (heightError) {
			return heightError;
		}
	}

	return null;
}

export function formatDisplayScaleLabel(scale: number): string {
	return `${Math.round(clampDisplayScale(scale) * 100)}%`;
}
