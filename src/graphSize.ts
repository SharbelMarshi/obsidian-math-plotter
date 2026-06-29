import type { GraphSpec } from './graphSpec';
import type { MathGraphSettings } from './settings';

export type GraphSizePreset = 'small' | 'medium' | 'large' | 'fullWidth' | 'custom';

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

const PRESET_2D: Record<Exclude<GraphSizePreset, 'custom'>, { width: string; height: string }> = {
	small: { width: '8cm', height: '5cm' },
	medium: { width: '11cm', height: '7cm' },
	large: { width: '15cm', height: '9cm' },
	fullWidth: { width: '17cm', height: '10cm' },
};

const PRESET_3D_HEIGHT: Record<Exclude<GraphSizePreset, 'custom'>, string> = {
	small: '8cm',
	medium: '9cm',
	large: '10cm',
	fullWidth: '10cm',
};

const PRESET_3D_WIDTH: Record<Exclude<GraphSizePreset, 'custom'>, string> = {
	small: '12cm',
	medium: '13cm',
	large: '15cm',
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

export function defaultGraphSize(settings?: Partial<MathGraphSettings>): GraphSizeSettings {
	const preset = (settings?.defaultSizePreset ?? 'large') as GraphSizePreset;
	return {
		preset,
		width: settings?.default2dWidth ?? '15cm',
		height: settings?.default2dHeight ?? '9cm',
		displayScale: clampDisplayScale(settings?.defaultDisplayScale ?? 1),
	};
}

export function defaultGraphSizeForSpec(
	spec: GraphSpec,
	settings?: Partial<MathGraphSettings>,
): GraphSizeSettings {
	const base = defaultGraphSize(settings);
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
		width: settings?.default3dWidth ?? '15cm',
		height: settings?.default3dHeight ?? '10cm',
	};
}

export function ensureGraphSize(spec: GraphSpec, settings?: Partial<MathGraphSettings>): GraphSizeSettings {
	if (spec.size?.preset) {
		return {
			preset: spec.size.preset,
			width: spec.size.width,
			height: spec.size.height,
			displayScale: clampDisplayScale(spec.size.displayScale ?? 1),
		};
	}

	// Legacy export fields
	if (spec.export?.width || spec.export?.height) {
		return {
			preset: 'custom',
			width: spec.export.width ?? settings?.default2dWidth ?? '15cm',
			height: spec.export.height ?? settings?.default2dHeight ?? '9cm',
			displayScale: 1,
		};
	}

	return defaultGraphSizeForSpec(spec, settings);
}

export function hydrateGraphSize(spec: GraphSpec, settings?: Partial<MathGraphSettings>): GraphSpec {
	spec.size = ensureGraphSize(spec, settings);
	return spec;
}

/**
 * PGFPlots axis width/height for LaTeX rendering.
 * Changing these requires recompiling the graph.
 */
export function resolveLatexGraphDimensions(
	spec: GraphSpec,
	settings?: Partial<MathGraphSettings>,
): { width: string; height: string } {
	const size = ensureGraphSize(spec, settings);
	const is3d = isGraph3dView(spec);

	if (size.preset === 'custom') {
		const width = size.width?.trim()
			|| (is3d ? settings?.default3dWidth : settings?.default2dWidth)
			|| '15cm';
		const height = size.height?.trim()
			|| (is3d ? settings?.default3dHeight : settings?.default2dHeight)
			|| (is3d ? '10cm' : '9cm');
		return { width, height };
	}

	const presetDims = PRESET_2D[size.preset];
	return {
		width: is3d ? PRESET_3D_WIDTH[size.preset] : presetDims.width,
		height: is3d ? PRESET_3D_HEIGHT[size.preset] : presetDims.height,
	};
}

/** @deprecated Use resolveLatexGraphDimensions */
export function resolveGraphDimensions(
	spec: GraphSpec,
	settings?: Partial<MathGraphSettings>,
): { width: string; height: string } {
	return resolveLatexGraphDimensions(spec, settings);
}

/** CSS display zoom for Reading View (does not affect LaTeX output). */
export function resolveDisplayScale(spec: GraphSpec, settings?: Partial<MathGraphSettings>): number {
	return clampDisplayScale(ensureGraphSize(spec, settings).displayScale ?? 1);
}

/** CSS classes for on-screen display layout (separate from LaTeX axis size). */
export function graphDisplayCssClasses(spec: GraphSpec, settings?: Partial<MathGraphSettings>): string {
	const size = ensureGraphSize(spec, settings);
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
	settings?: Partial<MathGraphSettings>,
	spec?: GraphSpec,
): GraphSizeSettings {
	const is3d = spec ? isGraph3dView(spec) : false;

	if (preset === 'custom') {
		const base = current ?? defaultGraphSize(settings);
		return {
			preset: 'custom',
			width: base.width ?? (is3d ? settings?.default3dWidth : settings?.default2dWidth) ?? '15cm',
			height: base.height ?? (is3d ? settings?.default3dHeight : settings?.default2dHeight) ?? (is3d ? '10cm' : '9cm'),
			displayScale: clampDisplayScale(base.displayScale ?? 1),
		};
	}

	return {
		preset,
		width: is3d ? PRESET_3D_WIDTH[preset] : PRESET_2D[preset].width,
		height: is3d ? PRESET_3D_HEIGHT[preset] : PRESET_2D[preset].height,
		displayScale: clampDisplayScale(current?.displayScale ?? 1),
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
