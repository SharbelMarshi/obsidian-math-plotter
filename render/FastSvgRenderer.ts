import {
	evaluateExpression,
	sampleFunction2D,
	samplePde2D,
	sampleSurface3D,
	type SamplePoint2D,
	type SamplePoint3D,
} from '../src/ExpressionEngine';
import { gridEnabledForGraph } from '../src/graphGridStyle';
import { isFastSvg3dGraph } from '../src/fastSvgRouter';
import { parseBoundToNumber } from '../src/graphRangeValidation';
import { resolveGraphPointCoordinates } from '../src/graphPointResolution';
import {
	getUserFunction,
	resolveGraphRotation,
	type GraphPoint,
	type GraphSpec,
	type GraphViewRotation,
} from '../src/graphSpec';
import {
	heatColorFromZ,
	resolveFastSvgStrokeColor,
	resolveSurfaceStyle,
} from '../src/graphPlotStyle';
import { formatTickLabel, TICK_LABEL_FONT } from '../src/formatTickLabel';
import { resolveAxisLineWidth, resolveLabelFontSize } from '../src/renderStyleConfig';
import { formatMathLabelText } from '../src/mathLabelText';
import type { GraphThemeColors } from '../src/graphThemeColors';
import { resolveGraphThemeColors } from '../src/graphThemeColors';
import { effectiveSamples2D, effectiveSamples3D } from './renderSampleDefaults';
import { ensureGraphSize } from '../src/graphSize';
import { resolveFastSvgPlotDimensions, tickTargetForSpan } from '../src/graphAspectLayout';

const PLOT_WIDTH_3D = 620;
const PLOT_HEIGHT_3D = 360;

interface CanvasLayout {
	width: number;
	height: number;
	plotLeft: number;
	plotTop: number;
	plotWidth: number;
	plotHeight: number;
	centerX: number;
	titleY: number | null;
}

function build2DCanvasLayout(spec: GraphSpec): CanvasLayout {
	const hasTitle = Boolean(spec.title?.trim());
	const hasXLabel = Boolean(spec.labels?.x?.trim());
	const topPad = hasTitle ? 24 : 8;
	const titleBand = hasTitle ? 14 : 0;
	const left = 36;
	const right = 24;
	const bottomPad = 20;
	const xLabelBand = hasXLabel ? 14 : 0;
	const plotTop = topPad + titleBand;
	const { plotWidth, plotHeight } = resolveFastSvgPlotDimensions(spec, ensureGraphSize(spec));
	const width = left + plotWidth + right;
	const height = plotTop + plotHeight + bottomPad + xLabelBand;
	return {
		width,
		height,
		plotLeft: left,
		plotTop,
		plotWidth,
		plotHeight,
		centerX: width / 2,
		titleY: hasTitle ? topPad + 10 : null,
	};
}

function build3DCanvasLayout(spec: GraphSpec): CanvasLayout {
	const hasTitle = Boolean(spec.title?.trim());
	const top = 12;
	const left = 20;
	const right = 20;
	const bottom = 12;
	const titleBand = hasTitle ? 14 : 0;
	const plotTop = top + titleBand;
	const width = left + PLOT_WIDTH_3D + right;
	const height = plotTop + PLOT_HEIGHT_3D + bottom;
	return {
		width,
		height,
		plotLeft: left,
		plotTop,
		plotWidth: PLOT_WIDTH_3D,
		plotHeight: PLOT_HEIGHT_3D,
		centerX: width / 2,
		titleY: hasTitle ? top + 10 : null,
	};
}

interface PlotBounds {
	xmin: number;
	xmax: number;
	ymin: number;
	ymax: number;
	zmin?: number;
	zmax?: number;
}

interface ProjectedPoint {
	px: number;
	py: number;
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function boundPair(range?: [string, string], fallback: [number, number] = [-5, 5]): [number, number] {
	const a = parseBoundToNumber(range?.[0] ?? '') ?? fallback[0];
	const b = parseBoundToNumber(range?.[1] ?? '') ?? fallback[1];
	return a <= b ? [a, b] : [b, a];
}

function plotBoundsFromSpec(spec: GraphSpec): PlotBounds {
	const x = boundPair(spec.ranges?.x);
	const y = boundPair(spec.ranges?.y);
	const z = boundPair(spec.ranges?.z, [-1, 1]);
	return { xmin: x[0], xmax: x[1], ymin: y[0], ymax: y[1], zmin: z[0], zmax: z[1] };
}

function svgPalette(theme: GraphThemeColors): {
	stroke: string;
	muted: string;
	grid: string;
	point: string;
} {
	return {
		stroke: theme.axis,
		muted: theme.text,
		grid: theme.grid,
		point: theme.isDark ? '#fbbf24' : '#dc2626',
	};
}

function niceTicks(min: number, max: number, target = 6): number[] {
	if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
		return [min];
	}
	const span = max - min;
	const raw = span / target;
	const mag = Math.pow(10, Math.floor(Math.log10(raw)));
	const step = Math.ceil(raw / mag) * mag;
	const start = Math.ceil(min / step) * step;
	const ticks: number[] = [];
	for (let v = start; v <= max + step * 0.01; v += step) {
		ticks.push(Number.parseFloat(v.toPrecision(10)));
	}
	return ticks.length > 0 ? ticks : [min, max];
}

function compute2DDataBounds(
	spec: GraphSpec,
	points: SamplePoint2D[],
): PlotBounds {
	let bounds = plotBoundsFromSpec(spec);
	let ymin = bounds.ymin;
	let ymax = bounds.ymax;
	for (const p of points) {
		if (Number.isFinite(p.y)) {
			ymin = Math.min(ymin, p.y);
			ymax = Math.max(ymax, p.y);
		}
	}
	if (spec.type === 'data') {
		const ys = points.map(p => p.y);
		if (ys.length > 0) {
			ymin = Math.min(...ys);
			ymax = Math.max(...ys);
		}
	}
	const yPad = (ymax - ymin) * 0.08 || 1;
	return {
		...bounds,
		ymin: ymin - yPad,
		ymax: ymax + yPad,
	};
}

function makeScales(bounds: PlotBounds, width: number, height: number, left: number, top: number) {
	const xScale = (x: number) => left + ((x - bounds.xmin) / (bounds.xmax - bounds.xmin)) * width;
	const yScale = (y: number) => top + height - ((y - bounds.ymin) / (bounds.ymax - bounds.ymin)) * height;
	return { xScale, yScale };
}

function renderTitle(
	title: string | undefined,
	colors: ReturnType<typeof svgPalette>,
	centerX: number,
	titleY: number | null,
	fontSize: number,
): string {
	if (!title?.trim() || titleY === null) {
		return '';
	}
	return `<text x="${centerX}" y="${titleY}" text-anchor="middle" font-size="${fontSize}" font-family="${TICK_LABEL_FONT}" fill="${colors.stroke}">${escapeXml(formatMathLabelText(title))}</text>`;
}

function renderGrid2D(
	bounds: PlotBounds,
	xScale: (x: number) => number,
	yScale: (y: number) => number,
	colors: ReturnType<typeof svgPalette>,
): string {
	const parts: string[] = [];
	const xSpan = bounds.xmax - bounds.xmin;
	const ySpan = bounds.ymax - bounds.ymin;
	for (const x of niceTicks(bounds.xmin, bounds.xmax, tickTargetForSpan(xSpan))) {
		const px = xScale(x);
		parts.push(`<line x1="${px}" y1="${yScale(bounds.ymin)}" x2="${px}" y2="${yScale(bounds.ymax)}" stroke="${colors.grid}" stroke-width="1"/>`);
	}
	for (const y of niceTicks(bounds.ymin, bounds.ymax, tickTargetForSpan(ySpan))) {
		const py = yScale(y);
		parts.push(`<line x1="${xScale(bounds.xmin)}" y1="${py}" x2="${xScale(bounds.xmax)}" y2="${py}" stroke="${colors.grid}" stroke-width="1"/>`);
	}
	return parts.join('');
}

function renderAxes2D(
	spec: GraphSpec,
	bounds: PlotBounds,
	xScale: (x: number) => number,
	yScale: (y: number) => number,
	left: number,
	top: number,
	width: number,
	height: number,
	colors: ReturnType<typeof svgPalette>,
): string {
	const parts: string[] = [];
	const labels = spec.labels ?? {};
	const axisY = bounds.ymin <= 0 && bounds.ymax >= 0 ? yScale(0) : yScale(bounds.ymin);
	const axisX = bounds.xmin <= 0 && bounds.xmax >= 0 ? xScale(0) : xScale(bounds.xmin);
	const xSpan = bounds.xmax - bounds.xmin;
	const ySpan = bounds.ymax - bounds.ymin;

	const axisWidth = resolveAxisLineWidth(spec);
	parts.push(`<line x1="${left}" y1="${axisY}" x2="${left + width}" y2="${axisY}" stroke="${colors.stroke}" stroke-width="${axisWidth}"/>`);
	parts.push(`<line x1="${axisX}" y1="${top}" x2="${axisX}" y2="${top + height}" stroke="${colors.stroke}" stroke-width="${axisWidth}"/>`);

	for (const x of niceTicks(bounds.xmin, bounds.xmax, tickTargetForSpan(xSpan))) {
		const px = xScale(x);
		parts.push(`<line x1="${px}" y1="${axisY - 4}" x2="${px}" y2="${axisY + 4}" stroke="${colors.stroke}" stroke-width="1"/>`);
		parts.push(`<text x="${px}" y="${axisY + 14}" text-anchor="middle" font-size="11" fill="${colors.muted}" font-family="${TICK_LABEL_FONT}">${formatTickLabel(x)}</text>`);
	}
	for (const y of niceTicks(bounds.ymin, bounds.ymax, tickTargetForSpan(ySpan))) {
		const py = yScale(y);
		parts.push(`<line x1="${axisX - 4}" y1="${py}" x2="${axisX + 4}" y2="${py}" stroke="${colors.stroke}" stroke-width="1"/>`);
		parts.push(`<text x="${axisX - 10}" y="${py + 4}" text-anchor="end" font-size="11" fill="${colors.muted}" font-family="${TICK_LABEL_FONT}">${formatTickLabel(y)}</text>`);
	}

	if (labels.x?.trim()) {
		parts.push(`<text x="${left + width / 2}" y="${top + height + 14}" text-anchor="middle" font-size="${resolveLabelFontSize(spec)}" fill="${colors.stroke}" font-family="${TICK_LABEL_FONT}">${escapeXml(formatMathLabelText(labels.x))}</text>`);
	}
	if (labels.y?.trim()) {
		parts.push(`<text x="${left - 14}" y="${top + height / 2}" text-anchor="middle" font-size="${resolveLabelFontSize(spec)}" fill="${colors.stroke}" font-family="${TICK_LABEL_FONT}" transform="rotate(-90 ${left - 14} ${top + height / 2})">${escapeXml(formatMathLabelText(labels.y))}</text>`);
	}

	return parts.join('');
}

function pathFrom2DPoints(points: SamplePoint2D[], xScale: (x: number) => number, yScale: (y: number) => number): string {
	if (points.length === 0) {
		return '';
	}
	const segments = points.map((p, i) => {
		const cmd = i === 0 ? 'M' : 'L';
		return `${cmd}${xScale(p.x)},${yScale(p.y)}`;
	});
	return `<path d="${segments.join(' ')}" fill="none" stroke-width="2"/>`;
}

function sampleParametric2D(spec: GraphSpec, samples: number): SamplePoint2D[] {
	const tRange = boundPair(spec.ranges?.t, [0, 2 * Math.PI]);
	const parameters = spec.parameters ?? {};
	const points: SamplePoint2D[] = [];
	const ts = Array.from({ length: samples }, (_, i) => tRange[0] + (tRange[1] - tRange[0]) * (i / (samples - 1 || 1)));
	for (const t of ts) {
		const x = evaluateExpression(spec.xExpression ?? '0', { t }, parameters, { variables: ['x', 'y', 'z', 't'], parameters });
		const y = evaluateExpression(spec.yExpression ?? '0', { t }, parameters, { variables: ['x', 'y', 'z', 't'], parameters });
		points.push({ x, y });
	}
	return points;
}

function sampleParametric3D(spec: GraphSpec, samples: number): SamplePoint3D[] {
	const tRange = boundPair(spec.ranges?.t, [0, 2 * Math.PI]);
	const parameters = spec.parameters ?? {};
	const pts: SamplePoint3D[] = [];
	const ts = Array.from({ length: samples }, (_, i) => tRange[0] + (tRange[1] - tRange[0]) * (i / (samples - 1 || 1)));
	for (const t of ts) {
		const x = evaluateExpression(spec.xExpression ?? '0', { t }, parameters, { variables: ['x', 'y', 'z', 't'], parameters });
		const y = evaluateExpression(spec.yExpression ?? '0', { t }, parameters, { variables: ['x', 'y', 'z', 't'], parameters });
		const z = evaluateExpression(spec.zExpression ?? '0', { t }, parameters, { variables: ['x', 'y', 'z', 't'], parameters });
		pts.push({ x, y, z });
	}
	return pts;
}

function sampleData2D(spec: GraphSpec): SamplePoint2D[] {
	const rows = spec.data ?? spec.points?.map(p => ({ x: p.x, y: p.y ?? '0' })) ?? [];
	return rows
		.map(row => ({
			x: parseBoundToNumber(row.x) ?? 0,
			y: parseBoundToNumber(row.y) ?? 0,
		}))
		.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
}

/**
 * Orbit projection: azimuth spins the view horizontally around the z axis,
 * elevation tilts it vertically (0 = side view, 90 = top-down). The default
 * 45/28 matches pgfplots' view={45}{28}.
 */
function projectOrbit(
	x: number,
	y: number,
	z: number,
	rotation: GraphViewRotation,
): ProjectedPoint {
	const azimuth = (rotation.azimuth * Math.PI) / 180;
	const elevation = (rotation.elevation * Math.PI) / 180;
	const rotatedX = x * Math.cos(azimuth) - y * Math.sin(azimuth);
	const depth = x * Math.sin(azimuth) + y * Math.cos(azimuth);
	return {
		px: rotatedX,
		py: -z * Math.cos(elevation) + depth * Math.sin(elevation),
	};
}

function createProjectionLayout(
	worldPoints: Array<{ x: number; y: number; z: number }>,
	left: number,
	top: number,
	width: number,
	height: number,
	rotation: GraphViewRotation,
): {
	projectWorld: (x: number, y: number, z: number) => ProjectedPoint;
	/** Linear projected→screen transform: screenX = ax·px + bx, screenY = ay·py + by. */
	screenTransform: { ax: number; bx: number; ay: number; by: number };
} {
	const raw = worldPoints.map(p => projectOrbit(p.x, p.y, p.z, rotation));
	let minX = raw[0]?.px ?? 0;
	let maxX = raw[0]?.px ?? 0;
	let minY = raw[0]?.py ?? 0;
	let maxY = raw[0]?.py ?? 0;
	for (const p of raw) {
		minX = Math.min(minX, p.px);
		maxX = Math.max(maxX, p.px);
		minY = Math.min(minY, p.py);
		maxY = Math.max(maxY, p.py);
	}
	const spanX = maxX - minX || 1;
	const spanY = maxY - minY || 1;
	const pad = 0.08;
	const ax = (width * (1 - 2 * pad)) / spanX;
	const bx = left + pad * width - minX * ax;
	const ay = (height * (1 - 2 * pad)) / spanY;
	const by = top + pad * height - minY * ay;
	const toScreen = (px: number, py: number): ProjectedPoint => ({
		px: ax * px + bx,
		py: ay * py + by,
	});
	return {
		projectWorld: (x, y, z) => {
			const p = projectOrbit(x, y, z, rotation);
			return toScreen(p.px, p.py);
		},
		screenTransform: { ax, bx, ay, by },
	};
}

function renderSurfaceMeshWithLayout(
	grid: SamplePoint3D[],
	samplesX: number,
	samplesY: number,
	projectWorld: (x: number, y: number, z: number) => ProjectedPoint,
	stroke: string,
	surfaceStyle: ReturnType<typeof resolveSurfaceStyle>,
	zMin: number,
	zMax: number,
): string {
	const paths: string[] = [];
	const useHeat = surfaceStyle === 'colored' || surfaceStyle === 'solid';
	const lineWidth = surfaceStyle === 'solid' ? '1.2' : '1';

	const addSegment = (a: SamplePoint3D, b: SamplePoint3D): void => {
		const p1 = projectWorld(a.x, a.y, a.z);
		const p2 = projectWorld(b.x, b.y, b.z);
		const segmentStroke = useHeat ? heatColorFromZ((a.z + b.z) / 2, zMin, zMax) : stroke;
		paths.push(
			`<path d="M${p1.px},${p1.py} L${p2.px},${p2.py}" fill="none" stroke="${segmentStroke}" stroke-width="${lineWidth}"/>`,
		);
	};

	for (let row = 0; row < samplesY; row++) {
		for (let col = 1; col < samplesX; col++) {
			const a = grid[row * samplesX + col - 1];
			const b = grid[row * samplesX + col];
			if (a && b) {
				addSegment(a, b);
			}
		}
	}

	for (let col = 0; col < samplesX; col++) {
		for (let row = 1; row < samplesY; row++) {
			const a = grid[(row - 1) * samplesX + col];
			const b = grid[row * samplesX + col];
			if (a && b) {
				addSegment(a, b);
			}
		}
	}

	if (surfaceStyle === 'solid') {
		for (let row = 0; row < samplesY - 1; row++) {
			for (let col = 0; col < samplesX - 1; col++) {
				const p00 = grid[row * samplesX + col];
				const p10 = grid[row * samplesX + col + 1];
				const p01 = grid[(row + 1) * samplesX + col];
				const p11 = grid[(row + 1) * samplesX + col + 1];
				if (!p00 || !p10 || !p01 || !p11) {
					continue;
				}
				const avgZ = (p00.z + p10.z + p01.z + p11.z) / 4;
				const fill = heatColorFromZ(avgZ, zMin, zMax);
				const a = projectWorld(p00.x, p00.y, p00.z);
				const b = projectWorld(p10.x, p10.y, p10.z);
				const c = projectWorld(p11.x, p11.y, p11.z);
				const d = projectWorld(p01.x, p01.y, p01.z);
				paths.unshift(
					`<path d="M${a.px},${a.py} L${b.px},${b.py} L${c.px},${c.py} L${d.px},${d.py} Z" fill="${fill}" fill-opacity="0.72" stroke="none"/>`,
				);
			}
		}
	}

	return paths.join('');
}

function axisArrowMarker(stroke: string): string {
	return `<defs><marker id="mathgraph-axis-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="${stroke}"/></marker></defs>`;
}

function axisScreenDirection(from: ProjectedPoint, to: ProjectedPoint): { x: number; y: number } {
	return { x: to.px - from.px, y: to.py - from.py };
}

function placeAxisLabel(
	endpoint: ProjectedPoint,
	direction: { x: number; y: number },
	distance: number,
	extra: { x: number; y: number } = { x: 0, y: 0 },
): { x: number; y: number } {
	const len = Math.hypot(direction.x, direction.y) || 1;
	return {
		x: endpoint.px + (direction.x / len) * distance + extra.x,
		y: endpoint.py + (direction.y / len) * distance + extra.y,
	};
}

function perpendicularOffset(direction: { x: number; y: number }, amount: number): { x: number; y: number } {
	const len = Math.hypot(direction.x, direction.y) || 1;
	return { x: (-direction.y / len) * amount, y: (direction.x / len) * amount };
}

function textAnchorForDirection(direction: { x: number; y: number }): string {
	if (Math.abs(direction.x) >= Math.abs(direction.y) * 0.6) {
		return direction.x >= 0 ? 'start' : 'end';
	}
	return 'middle';
}

function render3DAxisLabelText(
	text: string,
	position: { x: number; y: number },
	anchor: string,
	fill: string,
	className: string,
	fontSize: number,
): string {
	return `<text class="${className}" x="${position.x.toFixed(2)}" y="${position.y.toFixed(2)}" text-anchor="${anchor}" dominant-baseline="middle" font-size="${fontSize}" fill="${fill}" font-family="${TICK_LABEL_FONT}" pointer-events="none">${escapeXml(text)}</text>`;
}

function renderAxisLine(
	from: ProjectedPoint,
	to: ProjectedPoint,
	stroke: string,
	lineWidth: number,
): string {
	return `<line x1="${from.px}" y1="${from.py}" x2="${to.px}" y2="${to.py}" stroke="${stroke}" stroke-width="${lineWidth}" marker-end="url(#mathgraph-axis-arrow)"/>`;
}

function clampToRange(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/**
 * 3D axes pass through the true origin (0,0,0), clamped into the plotted domain,
 * so the crossing point is the actual coordinate origin — matching the 2D style
 * and making user points at (0,0,0) sit exactly on the crossing.
 */
function axis3DEndpoints(
	xMin: number,
	xMax: number,
	yMin: number,
	yMax: number,
	zMin: number,
	zMax: number,
): {
	origin: { x: number; y: number; z: number };
	xStart: { x: number; y: number; z: number };
	xEnd: { x: number; y: number; z: number };
	yStart: { x: number; y: number; z: number };
	yEnd: { x: number; y: number; z: number };
	zStart: { x: number; y: number; z: number };
	zEnd: { x: number; y: number; z: number };
} {
	const cx = clampToRange(0, xMin, xMax);
	const cy = clampToRange(0, yMin, yMax);
	const cz = clampToRange(0, zMin, zMax);
	return {
		origin: { x: cx, y: cy, z: cz },
		xStart: { x: xMin, y: cy, z: cz },
		xEnd: { x: xMax, y: cy, z: cz },
		yStart: { x: cx, y: yMin, z: cz },
		yEnd: { x: cx, y: yMax, z: cz },
		zStart: { x: cx, y: cy, z: zMin },
		zEnd: { x: cx, y: cy, z: zMax },
	};
}

function render3DAxisLines(
	xMin: number,
	xMax: number,
	yMin: number,
	yMax: number,
	zMin: number,
	zMax: number,
	projectWorld: (x: number, y: number, z: number) => ProjectedPoint,
	stroke: string,
	lineWidth: number,
): string {
	const axes = axis3DEndpoints(xMin, xMax, yMin, yMax, zMin, zMax);
	const project = (p: { x: number; y: number; z: number }) => projectWorld(p.x, p.y, p.z);
	return [
		axisArrowMarker(stroke),
		renderAxisLine(project(axes.xStart), project(axes.xEnd), stroke, lineWidth),
		renderAxisLine(project(axes.yStart), project(axes.yEnd), stroke, lineWidth),
		renderAxisLine(project(axes.zStart), project(axes.zEnd), stroke, lineWidth),
	].join('');
}

function render3DAxisLabels(
	xMin: number,
	xMax: number,
	yMin: number,
	yMax: number,
	zMin: number,
	zMax: number,
	projectWorld: (x: number, y: number, z: number) => ProjectedPoint,
	labels: { x?: string; y?: string; z?: string },
	labelColor: string,
	fontSize: number,
): string {
	const axes = axis3DEndpoints(xMin, xMax, yMin, yMax, zMin, zMax);
	const origin = projectWorld(axes.origin.x, axes.origin.y, axes.origin.z);
	const xEnd = projectWorld(axes.xEnd.x, axes.xEnd.y, axes.xEnd.z);
	const yEnd = projectWorld(axes.yEnd.x, axes.yEnd.y, axes.yEnd.z);
	const zEnd = projectWorld(axes.zEnd.x, axes.zEnd.y, axes.zEnd.z);

	const xDir = axisScreenDirection(origin, xEnd);
	const yDir = axisScreenDirection(origin, yEnd);
	const zDir = axisScreenDirection(origin, zEnd);
	const yPerp = perpendicularOffset(yDir, 5);

	const parts: string[] = [];

	if (labels.x?.trim()) {
		const pos = placeAxisLabel(xEnd, xDir, 22);
		parts.push(render3DAxisLabelText(
			formatMathLabelText(labels.x),
			pos,
			textAnchorForDirection(xDir),
			labelColor,
			'mathgraph-axis-label mathgraph-axis-label-x',
			fontSize,
		));
	}

	if (labels.y?.trim()) {
		const pos = placeAxisLabel(yEnd, yDir, 28, {
			x: yPerp.x + 2,
			y: yPerp.y + 8,
		});
		parts.push(render3DAxisLabelText(
			formatMathLabelText(labels.y),
			pos,
			textAnchorForDirection(yDir),
			labelColor,
			'mathgraph-axis-label mathgraph-axis-label-y',
			fontSize,
		));
	}

	if (labels.z?.trim()) {
		const pos = placeAxisLabel(zEnd, zDir, 18, { x: 8, y: -14 });
		parts.push(render3DAxisLabelText(
			formatMathLabelText(labels.z),
			pos,
			textAnchorForDirection(zDir),
			labelColor,
			'mathgraph-axis-label mathgraph-axis-label-z',
			fontSize,
		));
	}

	return parts.join('');
}

function renderPoints2D(
	spec: GraphSpec,
	xScale: (x: number) => number,
	yScale: (y: number) => number,
	colors: ReturnType<typeof svgPalette>,
): string {
	const points = spec.points ?? [];
	if (points.length === 0) {
		return '';
	}

	const parts: string[] = [];
	for (const point of points) {
		const resolved = resolveGraphPointCoordinates(spec, point);
		if (!resolved) {
			continue;
		}
		const x = parseBoundToNumber(resolved.x);
		const y = parseBoundToNumber(resolved.y);
		if (x === null || y === null) {
			continue;
		}
		const px = xScale(x);
		const py = yScale(y);
		parts.push(`<circle cx="${px}" cy="${py}" r="4.5" fill="${colors.point}" stroke="${colors.stroke}" stroke-width="1"/>`);
		if (point.label?.trim()) {
			parts.push(`<text x="${px + 8}" y="${py - 8}" font-size="12" fill="${colors.stroke}" font-family="${TICK_LABEL_FONT}">${escapeXml(formatMathLabelText(point.label))}</text>`);
		}
		if (point.showValue) {
			parts.push(`<text x="${px}" y="${py + 16}" text-anchor="middle" font-size="11" fill="${colors.muted}" font-family="${TICK_LABEL_FONT}">(${formatCoordValue(x)}, ${formatCoordValue(y)})</text>`);
		}
	}
	return parts.join('');
}

function formatCoordValue(value: number): string {
	return String(Number.parseFloat(value.toFixed(3)));
}

interface WorldPoint3D {
	point: GraphPoint;
	x: number;
	y: number;
	z: number;
}

/** Resolve user points into numeric world coordinates (computed z included). */
function resolveWorldPoints3D(spec: GraphSpec): WorldPoint3D[] {
	const points = spec.points ?? [];
	const resolvedPoints: WorldPoint3D[] = [];
	for (const point of points) {
		const resolved = resolveGraphPointCoordinates(spec, point);
		if (!resolved) {
			continue;
		}
		const x = parseBoundToNumber(resolved.x);
		const y = parseBoundToNumber(resolved.y);
		const z = parseBoundToNumber(resolved.z ?? '0');
		if (x === null || y === null || z === null) {
			continue;
		}
		resolvedPoints.push({ point, x, y, z });
	}
	return resolvedPoints;
}

/** Draw user points with the same projection as the surface so they land on the graph. */
function renderPoints3D(
	worldPoints: WorldPoint3D[],
	projectWorld: (x: number, y: number, z: number) => ProjectedPoint,
	colors: ReturnType<typeof svgPalette>,
): string {
	return worldPoints.map(({ point, x, y, z }) => {
		const p = projectWorld(x, y, z);
		const label = point.label?.trim();
		const labelSvg = label
			? `<text x="${p.px + 8}" y="${p.py - 8}" font-size="12" fill="${colors.stroke}" font-family="${TICK_LABEL_FONT}">${escapeXml(formatMathLabelText(label))}</text>`
			: '';
		const valueSvg = point.showValue
			? `<text x="${p.px}" y="${p.py + 16}" text-anchor="middle" font-size="11" fill="${colors.muted}" font-family="${TICK_LABEL_FONT}">(${formatCoordValue(x)}, ${formatCoordValue(y)}, ${formatCoordValue(z)})</text>`
			: '';
		return `<circle cx="${p.px}" cy="${p.py}" r="4.5" fill="${colors.point}" stroke="${colors.stroke}" stroke-width="1"/>${labelSvg}${valueSvg}`;
	}).join('');
}

function collect2DSamples(spec: GraphSpec): SamplePoint2D[] {
	const samples = effectiveSamples2D(spec, 'svgFast');
	const parameters = spec.parameters ?? {};
	const expression = getUserFunction(spec);

	switch (spec.type) {
		case 'function2d':
		case 'ode': {
			const [xMin, xMax] = boundPair(spec.ranges?.x);
			return sampleFunction2D(expression, xMin, xMax, samples, parameters);
		}
		case 'pde': {
			const [xMin, xMax] = boundPair(spec.ranges?.x);
			const [yMin, yMax] = boundPair(spec.ranges?.y);
			return samplePde2D(expression, xMin, xMax, yMin, yMax, samples, parameters)
				.map(p => ({ x: p.x, y: p.u }));
		}
		case 'data':
			return sampleData2D(spec);
		case 'parametric2d':
			return sampleParametric2D(spec, samples);
		default:
			return [];
	}
}

function render2DGraph(spec: GraphSpec, theme: GraphThemeColors): string {
	const colors = svgPalette(theme);
	const curveColor = resolveFastSvgStrokeColor(spec, theme.defaultLine);
	const points = collect2DSamples(spec);
	const bounds = compute2DDataBounds(spec, points);
	const layout = build2DCanvasLayout(spec);
	const { xScale, yScale } = makeScales(
		bounds,
		layout.plotWidth,
		layout.plotHeight,
		layout.plotLeft,
		layout.plotTop,
	);

	const grid = gridEnabledForGraph(spec)
		? renderGrid2D(bounds, xScale, yScale, colors)
		: '';
	const axes = renderAxes2D(
		spec,
		bounds,
		xScale,
		yScale,
		layout.plotLeft,
		layout.plotTop,
		layout.plotWidth,
		layout.plotHeight,
		colors,
	);
	const curve = pathFrom2DPoints(points, xScale, yScale).replace('stroke-width="2"', `stroke="${curveColor}" stroke-width="2"`);
	const markers = renderPoints2D(spec, xScale, yScale, colors);

	// Calibration data lets the graph view map pointer positions back to graph coordinates.
	const calibration = `data-mg-plot="${layout.plotLeft},${layout.plotTop},${layout.plotWidth},${layout.plotHeight}" data-mg-window="${bounds.xmin},${bounds.xmax},${bounds.ymin},${bounds.ymax}"`;

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" ${calibration}>`,
		renderTitle(spec.title, colors, layout.centerX, layout.titleY, resolveLabelFontSize(spec)),
		grid,
		axes,
		curve,
		markers,
		'</svg>',
	].join('');
}

function render3DGraph(spec: GraphSpec, theme: GraphThemeColors): string {
	const colors = svgPalette(theme);
	const axisStroke = theme.axis;
	const curveColor = resolveFastSvgStrokeColor(spec, theme.defaultWireframe);
	const layout = build3DCanvasLayout(spec);
	let { samplesX, samplesY } = effectiveSamples3D(spec, 'svgFast');
	const parameters = spec.parameters ?? {};
	const expression = getUserFunction(spec);
	const [xMin, xMax] = boundPair(spec.ranges?.x, [-Math.PI, Math.PI]);
	const [yMin, yMax] = boundPair(spec.ranges?.y, [-Math.PI, Math.PI]);

	let grid: SamplePoint3D[];
	if (spec.type === 'parametric3d') {
		grid = sampleParametric3D(spec, Math.max(samplesX, 80));
		samplesX = grid.length;
		samplesY = 1;
	} else {
		grid = sampleSurface3D(expression, xMin, xMax, yMin, yMax, samplesX, samplesY, parameters);
	}

	let zMin = Number.POSITIVE_INFINITY;
	let zMax = Number.NEGATIVE_INFINITY;
	for (const p of grid) {
		if (Number.isFinite(p.z)) {
			zMin = Math.min(zMin, p.z);
			zMax = Math.max(zMax, p.z);
		}
	}
	if (!Number.isFinite(zMin) || !Number.isFinite(zMax)) {
		const zRange = boundPair(spec.ranges?.z, [-1, 1]);
		zMin = zRange[0];
		zMax = zRange[1];
	}

	const worldPoints = resolveWorldPoints3D(spec);
	const axisCorners = [
		{ x: xMin, y: yMin, z: zMin },
		{ x: xMax, y: yMin, z: zMin },
		{ x: xMin, y: yMax, z: zMin },
		{ x: xMin, y: yMin, z: zMax },
		...grid,
		...worldPoints.map(({ x, y, z }) => ({ x, y, z })),
	];

	// Normalize each axis to [-1, 1] before projecting, like pgfplots scales its
	// axis box — otherwise a large z-range flattens the surface into a thin band.
	const xSpan = xMax - xMin || 1;
	const ySpan = yMax - yMin || 1;
	const zSpan = zMax - zMin || 1;
	const normalize = (x: number, y: number, z: number) => ({
		x: ((x - xMin) / xSpan) * 2 - 1,
		y: ((y - yMin) / ySpan) * 2 - 1,
		z: ((z - zMin) / zSpan) * 2 - 1,
	});

	const rotation = resolveGraphRotation(spec);
	const projection = createProjectionLayout(
		axisCorners.map(p => normalize(p.x, p.y, p.z)),
		layout.plotLeft,
		layout.plotTop,
		layout.plotWidth,
		layout.plotHeight,
		rotation,
	);
	const projectWorld = (x: number, y: number, z: number): ProjectedPoint => {
		const n = normalize(x, y, z);
		return projection.projectWorld(n.x, n.y, n.z);
	};
	const labels = spec.labels ?? { x: 'x', y: 'y', z: 'z' };

	const surfaceStyle = resolveSurfaceStyle(spec);
	const mesh = spec.type === 'parametric3d'
		? (() => {
			const d = grid.map((p, i) => {
				const pt = projectWorld(p.x, p.y, p.z);
				return `${i === 0 ? 'M' : 'L'}${pt.px},${pt.py}`;
			}).join(' ');
			return `<path d="${d}" fill="none" stroke="${curveColor}" stroke-width="2"/>`;
		})()
		: renderSurfaceMeshWithLayout(
			grid,
			samplesX,
			samplesY,
			projectWorld,
			curveColor,
			surfaceStyle,
			zMin,
			zMax,
		);

	const axisLines = render3DAxisLines(
		xMin,
		xMax,
		yMin,
		yMax,
		zMin,
		zMax,
		projectWorld,
		axisStroke,
		resolveAxisLineWidth(spec) + 1,
	);
	const axisLabels = render3DAxisLabels(
		xMin,
		xMax,
		yMin,
		yMax,
		zMin,
		zMax,
		projectWorld,
		labels,
		theme.text,
		resolveLabelFontSize(spec),
	);

	// Calibration data lets the graph view map pointer positions back to 3D world coordinates.
	const transform = projection.screenTransform;
	const calibration3d = [
		xMin, xMax, yMin, yMax, zMin, zMax,
		rotation.azimuth, rotation.elevation,
		transform.ax, transform.bx, transform.ay, transform.by,
	].map(value => Number.parseFloat(value.toPrecision(10))).join(',');

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" data-mg-3d="${calibration3d}">`,
		renderTitle(spec.title, colors, layout.centerX, layout.titleY, resolveLabelFontSize(spec)),
		mesh,
		axisLines,
		renderPoints3D(worldPoints, projectWorld, colors),
		axisLabels,
		'</svg>',
	].join('');
}

export function renderFastSvg(spec: GraphSpec, theme?: GraphThemeColors): string {
	const resolved = theme ?? resolveGraphThemeColors();
	if (isFastSvg3dGraph(spec)) {
		return render3DGraph(spec, resolved);
	}
	return render2DGraph(spec, resolved);
}

export class FastSvgRenderer {
	render(spec: GraphSpec, theme?: GraphThemeColors): string {
		return renderFastSvg(spec, theme);
	}
}
