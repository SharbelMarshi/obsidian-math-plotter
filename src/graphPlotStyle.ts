import { graphSupportsGridToggle } from './graphGridStyle';
import { isGraph3dView } from './graphSize';
import type { GraphSpec } from './graphSpec';

export type SurfaceStyle = 'wireframe' | 'colored' | 'solid';
export type ColormapName = 'heat' | 'viridis' | 'hot';

export const DEFAULT_2D_LINE_COLOR = 'auto';

/** Whether the plot color should follow the Obsidian theme (not a fixed user color). */
export function isAutoGraphColor(color: string | undefined): boolean {
	if (!color?.trim()) {
		return true;
	}
	const lower = color.trim().toLowerCase();
	return lower === 'auto' || lower === 'black';
}

/** 3D surface / PDE 3D graphs default to colored heat-style rendering. */
export function graphUsesColoredSurfaceDefault(spec: GraphSpec): boolean {
	if (spec.type === 'surface3d') {
		return true;
	}
	return spec.type === 'pde' && (spec.view ?? '3d') === '3d';
}

export function graphSupportsSurfaceStyleControl(spec: GraphSpec): boolean {
	return graphUsesColoredSurfaceDefault(spec);
}

function joinOptions(options: string[]): string {
	return options.filter(Boolean).join(', ');
}

export function resolveSurfaceStyle(spec: GraphSpec): SurfaceStyle {
	hydrateGraphStyle(spec);
	return spec.style?.surfaceStyle ?? (graphUsesColoredSurfaceDefault(spec) ? 'colored' : 'wireframe');
}

export function resolveColormap(spec: GraphSpec): ColormapName {
	hydrateGraphStyle(spec);
	const map = spec.style?.colormap?.trim().toLowerCase();
	if (map === 'viridis' || map === 'hot' || map === 'heat') {
		return map;
	}
	return 'heat';
}

/** Apply default/missing style fields for new and legacy graphs. */
export function hydrateGraphStyle(spec: GraphSpec): void {
	spec.style = spec.style ?? {};
	const style = spec.style;
	const colored3d = graphUsesColoredSurfaceDefault(spec);

	if (colored3d) {
		if (!style.surfaceStyle) {
			style.surfaceStyle = 'colored';
		}
		if (!style.colormap) {
			style.colormap = 'heat';
		}
	} else if (!isGraph3dView(spec)) {
		if (!style.color?.trim()) {
			style.color = DEFAULT_2D_LINE_COLOR;
		}
		if (!style.surfaceStyle) {
			style.surfaceStyle = 'wireframe';
		}
	}

	if (graphSupportsGridToggle(spec) && style.grid === undefined) {
		style.grid = true;
	}
}

export function isColoredSurfaceStyle(spec: GraphSpec): boolean {
	const style = resolveSurfaceStyle(spec);
	return style === 'colored' || style === 'solid';
}

export function isWireframeSurfaceStyle(spec: GraphSpec): boolean {
	return resolveSurfaceStyle(spec) === 'wireframe';
}

export function resolvePlotStrokeColor(spec: GraphSpec): string {
	hydrateGraphStyle(spec);
	const color = spec.style?.color?.trim();
	if (!color || isAutoGraphColor(color)) {
		return 'mathgraphLine';
	}
	return color;
}

export function buildSampled2dPlotOptions(spec: GraphSpec): string {
	hydrateGraphStyle(spec);
	const style = spec.style ?? {};
	return joinOptions([
		resolvePlotStrokeColor(spec),
		style.width ?? 'thick',
	]);
}

export function buildSampled3dPlotOptions(spec: GraphSpec): string {
	hydrateGraphStyle(spec);
	const surfaceStyle = resolveSurfaceStyle(spec);
	const colormap = resolveColormap(spec);
	const style = spec.style ?? {};

	if (surfaceStyle === 'wireframe') {
		const color = resolvePlotStrokeColor(spec);
		return joinOptions([
			'mesh',
			color,
			'thick',
			`draw=${color}`,
			style.width?.trim(),
		]);
	}

	if (surfaceStyle === 'solid') {
		return joinOptions([
			'surf',
			'shader=interp',
			`colormap/${colormap}`,
			'point meta=z',
			style.width?.trim(),
		]);
	}

	return joinOptions([
		'mesh',
		'thick',
		'point meta=z',
		`colormap/${colormap}`,
		style.width?.trim(),
	]);
}

/** Stroke color for direct SVG rendering (respects theme when color is auto). */
export function resolveFastSvgStrokeColor(
	spec: GraphSpec,
	themeDefaultLine: string,
): string {
	const color = spec.style?.color?.trim();
	if (!color || isAutoGraphColor(color)) {
		return themeDefaultLine;
	}
	return color;
}

/** Map normalized height t in [0,1] to a heat-like RGB color (blue → yellow → red). */
export function heatColorFromUnit(t: number): string {
	const clamped = Math.max(0, Math.min(1, t));
	if (clamped < 0.5) {
		const u = clamped * 2;
		const r = Math.round(40 + u * 215);
		const g = Math.round(90 + u * 110);
		const b = Math.round(255 - u * 255);
		return `rgb(${r},${g},${b})`;
	}
	const u = (clamped - 0.5) * 2;
	const r = Math.round(255 - u * 20);
	const g = Math.round(200 - u * 200);
	return `rgb(${r},${g},0)`;
}

export function heatColorFromZ(z: number, zMin: number, zMax: number): string {
	const span = zMax - zMin || 1;
	return heatColorFromUnit((z - zMin) / span);
}
