import { Menu, Notice } from 'obsidian';
import type { RenderImageResult } from '../render/types';
import {
	clampDisplayScale,
	ensureGraphSize,
	formatDisplayScaleLabel,
} from './graphSize';
import type { GraphSpec } from './graphSpec';
import { GRAPH_TYPE_LABELS } from './graphSpec';
import { resolveGraphPointCoordinates } from './graphPointResolution';
import { parseBoundToNumber } from './graphRangeValidation';
import {
	applyRenderedGraphLayoutScale,
	bindRenderedGraphLayoutScale,
} from './displayScaleLayout';

function downloadBlob(blob: Blob, filename: string, doc: Document): void {
	const url = URL.createObjectURL(blob);
	const link = doc.createElement('a');
	link.href = url;
	link.download = filename;
	doc.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}

function downloadSvg(svgText: string, doc: Document, filename = 'math-graph.svg'): void {
	const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
	downloadBlob(blob, filename, doc);
}

async function svgToPng(svgText: string, doc: Document): Promise<Blob> {
	const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
	const url = URL.createObjectURL(svgBlob);
	try {
		const img = new Image();
		img.src = url;
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error('Could not load SVG image.'));
		});

		const canvas = doc.createElement('canvas');
		canvas.width = img.naturalWidth || 800;
		canvas.height = img.naturalHeight || 600;
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			throw new Error('Canvas not available.');
		}
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(img, 0, 0);
		return await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(blob => {
				if (blob) {
					resolve(blob);
				} else {
					reject(new Error('PNG export failed.'));
				}
			}, 'image/png');
		});
	} finally {
		URL.revokeObjectURL(url);
	}
}

export interface GraphViewActions {
	onEdit?: () => void;
	onRefresh?: () => void;
	onDisplayScaleChange?: (newScale: number) => void | Promise<void>;
	/**
	 * 3D graphs only — rotate the view by the given deltas (degrees).
	 * phase 'preview' fires live while dragging; 'commit' fires on release.
	 */
	onRotateView?: (azimuthDelta: number, elevationDelta: number, phase: 'preview' | 'commit') => void;
	/**
	 * A point marker was dragged to graph coordinates (x, y).
	 * phase 'preview' fires live while dragging; 'commit' fires on release.
	 */
	onMovePoint?: (pointIndex: number, x: number, y: number, phase: 'preview' | 'commit') => void;
	/** Latest SVG text for export — reflects live rotation/point previews. */
	getExportSvgText?: () => string;
	/** When set, appended to render error details (debug mode). */
	debugSource?: string;
}

export interface GraphErrorAction {
	label: string;
	onClick: () => void;
	primary?: boolean;
	danger?: boolean;
}

export interface GraphErrorLocation {
	line: number;
	column?: number;
	length?: number;
}

export interface GraphErrorCodeFrame {
	source: string;
	location?: GraphErrorLocation;
	label?: string;
}

export interface GraphErrorOptions {
	details?: string;
	codeFrame?: GraphErrorCodeFrame;
	actions?: GraphErrorAction[];
	onRetry?: () => void;
}

function lineColumnFromOffset(source: string, offset: number): GraphErrorLocation {
	const safeOffset = Math.max(0, Math.min(offset, source.length));
	const before = source.slice(0, safeOffset);
	const parts = before.split('\n');
	return {
		line: parts.length,
		column: (parts.at(-1)?.length ?? 0) + 1,
	};
}

export function inferGraphErrorLocation(
	source: string,
	parts: Array<string | undefined>,
	lineHint?: number,
): GraphErrorLocation | undefined {
	for (const part of parts) {
		if (!part) {
			continue;
		}
		const lineColumn = /line\s+(\d+)(?:\s+column\s+(\d+))?/i.exec(part);
		if (lineColumn) {
			return {
				line: Number.parseInt(lineColumn[1], 10),
				column: lineColumn[2] ? Number.parseInt(lineColumn[2], 10) : undefined,
			};
		}

		const offsetMatch = /position\s+(\d+)/i.exec(part);
		if (offsetMatch) {
			return lineColumnFromOffset(source, Number.parseInt(offsetMatch[1], 10));
		}
	}

	if (typeof lineHint === 'number' && Number.isFinite(lineHint)) {
		return { line: Math.max(1, Math.floor(lineHint)) };
	}

	return undefined;
}

function highlightLengthForLocation(lineText: string, column?: number, explicitLength?: number): number {
	if (explicitLength && explicitLength > 0) {
		return explicitLength;
	}
	if (!column || column < 1) {
		return Math.max(1, lineText.trim().length);
	}
	const start = Math.min(lineText.length, column - 1);
	const tail = lineText.slice(start);
	const token = /^[^\s,;:()[\]{}]+/.exec(tail)?.[0];
	return Math.max(1, token?.length ?? 1);
}

function appendCodeFrame(parent: HTMLElement, codeFrame: GraphErrorCodeFrame): void {
	const wrapper = parent.createDiv({ cls: 'mathgraph-codeframe' });
	if (codeFrame.label) {
		wrapper.createDiv({ cls: 'mathgraph-codeframe-label', text: codeFrame.label });
	}

	if (codeFrame.location) {
		const parts = [`Line ${codeFrame.location.line}`];
		if (codeFrame.location.column) {
			parts.push(`column ${codeFrame.location.column}`);
		}
		wrapper.createDiv({ cls: 'mathgraph-codeframe-meta', text: parts.join(', ') });
	}

	const lines = codeFrame.source.replace(/\r\n/g, '\n').split('\n');
	lines.forEach((lineText, index) => {
		const row = wrapper.createDiv({ cls: 'mathgraph-codeframe-row' });
		row.createDiv({ cls: 'mathgraph-codeframe-gutter', text: String(index + 1) });
		const code = row.createDiv({ cls: 'mathgraph-codeframe-code' });

		const target = codeFrame.location?.line === index + 1 ? codeFrame.location : undefined;
		if (!target) {
			code.setText(lineText);
			return;
		}

		row.addClass('is-error-line');
		const column = Math.max(1, target.column ?? 1);
		const start = Math.max(0, column - 1);
		const length = highlightLengthForLocation(lineText, column, target.length);
		const before = lineText.slice(0, start);
		const marked = lineText.slice(start, start + length) || ' ';
		const after = lineText.slice(start + length);

		if (before) {
			code.createSpan({ text: before });
		}
		code.createSpan({ cls: 'mathgraph-codeframe-error', text: marked });
		if (after) {
			code.createSpan({ text: after });
		}
	});
}

export function applyRenderedGraphDisplayScale(container: HTMLElement, spec: GraphSpec, svgText?: string): void {
	applyRenderedGraphLayoutScale(container, spec, { svgText });
}

export function appendGraphError(
	parent: HTMLElement,
	message: string,
	detailsOrOptions?: string | GraphErrorOptions,
	onRetry?: () => void,
): void {
	const options: GraphErrorOptions = typeof detailsOrOptions === 'string'
		? { details: detailsOrOptions, onRetry }
		: (detailsOrOptions ?? {});

	if (!options.onRetry && onRetry) {
		options.onRetry = onRetry;
	}

	const errorEl = parent.createDiv({ cls: 'mathgraph-error-box' });
	errorEl.createDiv({ cls: 'mathgraph-error-title', text: message });

	if (options.details) {
		const detailsEl = errorEl.createEl('details', { cls: 'mathgraph-error-details' });
		const summary = detailsEl.createEl('summary', { text: 'Details' });
		summary.setAttr('aria-expanded', 'false');
		const body = detailsEl.createDiv({ cls: 'mathgraph-error-details-body' });
		body.setText(options.details);
		detailsEl.addEventListener('toggle', () => {
			summary.setAttr('aria-expanded', detailsEl.open ? 'true' : 'false');
		});
	}

	if (options.codeFrame) {
		appendCodeFrame(errorEl, options.codeFrame);
	}

	const actions = options.actions ?? [];
	if (options.onRetry) {
		actions.unshift({ label: 'Retry', onClick: options.onRetry });
	}

	if (actions.length > 0) {
		const buttonRow = errorEl.createDiv({ cls: 'mathgraph-error-actions' });
		for (const action of actions) {
			const classes = ['mathgraph-button'];
			if (action.primary) {
				classes.push('mathgraph-button-primary');
			} else if (action.danger) {
				classes.push('mathgraph-button-danger');
			} else {
				classes.push('mathgraph-button-secondary');
			}
			const btn = buttonRow.createEl('button', { text: action.label, cls: classes.join(' ') });
			btn.addEventListener('click', action.onClick);
		}
	}
}

export function renderGraphView(
	el: HTMLElement,
	spec: GraphSpec,
	result: RenderImageResult,
	tikzSource: string,
	actions: GraphViewActions = {},
): void {
	el.empty();
	el.addClass('mathgraph-root');

	if (!result.ok || !result.dataUrl || !result.svgText) {
		const detailParts = [result.rawLog, actions.debugSource].filter(Boolean);
		appendGraphError(el, result.error ?? 'Render failed.', {
			details: detailParts.length > 0 ? detailParts.join('\n\n--- generated source ---\n\n') : undefined,
			codeFrame: actions.debugSource
				? {
					source: actions.debugSource,
					location: inferGraphErrorLocation(actions.debugSource, [result.error, result.rawLog]),
					label: 'Generated source',
				}
				: undefined,
			onRetry: actions.onRefresh,
		});
		return;
	}

	const svgText = result.svgText;
	const size = ensureGraphSize(spec);

	if (spec.equation) {
		const header = el.createDiv({ cls: 'mathgraph-graph-caption' });
		header.createDiv({ cls: 'mathgraph-equation', text: spec.equation });
	}

	const block = el.createDiv({ cls: 'mathgraph-rendered-container' });
	const toolbar = block.createDiv({ cls: 'mathgraph-toolbar' });

	const makeButton = (
		label: string,
		handler: (event: MouseEvent) => void,
	) => {
		const cls = 'mathgraph-button mathgraph-button-secondary';
		const btn = toolbar.createEl('button', { text: label, cls, type: 'button' });
		btn.setAttr('tabindex', '-1');
		btn.addEventListener('mousedown', event => {
			event.preventDefault();
		});
		btn.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			handler(event);
		});
		return btn;
	};

	if (actions.onEdit) {
		const onEdit = actions.onEdit;
		makeButton('Edit', () => onEdit());
	}
	if (actions.onRefresh) {
		const onRefresh = actions.onRefresh;
		makeButton('Refresh', () => onRefresh());
	}

	if (actions.onDisplayScaleChange) {
		const minusBtn = toolbar.createEl('button', {
			text: '−',
			type: 'button',
			cls: 'mathgraph-button mathgraph-button-secondary mathgraph-scale-btn',
		});
		minusBtn.setAttr('tabindex', '-1');
		minusBtn.setAttr('aria-label', 'Decrease display scale');
		const scaleLabel = toolbar.createEl('button', {
			text: formatDisplayScaleLabel(size.displayScale ?? 1),
			type: 'button',
			cls: 'mathgraph-button mathgraph-button-secondary mathgraph-scale-label',
		});
		scaleLabel.setAttr('tabindex', '-1');
		scaleLabel.setAttr('aria-label', 'Reset display scale to 100%');
		scaleLabel.setAttr('title', 'Display scale — visual zoom in Obsidian (no LaTeX recompile)');
		const plusBtn = toolbar.createEl('button', {
			text: '+',
			type: 'button',
			cls: 'mathgraph-button mathgraph-button-secondary mathgraph-scale-btn',
		});
		plusBtn.setAttr('tabindex', '-1');
		plusBtn.setAttr('aria-label', 'Increase display scale');

		const bindScaleButton = (btn: HTMLButtonElement, handler: () => void) => {
			btn.addEventListener('mousedown', event => {
				event.preventDefault();
			});
			btn.addEventListener('click', event => {
				event.preventDefault();
				event.stopPropagation();
				handler();
			});
		};

		const applyScale = (next: number) => {
			size.displayScale = next;
			spec.size = size;
			scaleLabel.setText(formatDisplayScaleLabel(next));
			applyRenderedGraphDisplayScale(block, spec, svgText);
			const onDisplayScaleChange = actions.onDisplayScaleChange;
			if (onDisplayScaleChange) {
				void Promise.resolve(onDisplayScaleChange(next));
			}
		};

		const changeScale = (delta: number) => {
			const current = clampDisplayScale(size.displayScale ?? 1);
			const next = clampDisplayScale(current + delta);
			if (next === current) {
				return;
			}
			applyScale(next);
		};

		bindScaleButton(minusBtn, () => changeScale(-0.1));
		bindScaleButton(plusBtn, () => changeScale(0.1));
		bindScaleButton(scaleLabel, () => applyScale(1));

		// Trackpad pinch arrives as a wheel event with ctrlKey set (also covers Ctrl+scroll).
		block.addEventListener('wheel', event => {
			if (!event.ctrlKey) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			changeScale(-event.deltaY * 0.01);
		}, { passive: false });
	}

	// Export the latest view — including live rotation/point positions — not the initial render.
	const exportSvgText = () => actions.getExportSvgText?.() ?? svgText;

	const exportBtn = makeButton('Export', event => {
		const menu = new Menu();
		menu.addItem(item => item
			.setTitle('PNG')
			.onClick(() => {
				void svgToPng(exportSvgText(), el.ownerDocument).then(blob => {
					downloadBlob(blob, `${spec.title || 'math-graph'}.png`, el.ownerDocument);
					new Notice('PNG exported.');
				}).catch(err => {
					new Notice(err instanceof Error ? err.message : 'PNG export failed.');
				});
			}));
		menu.addItem(item => item
			.setTitle('SVG')
			.onClick(() => {
				downloadSvg(exportSvgText(), el.ownerDocument, `${spec.title || 'math-graph'}.svg`);
				new Notice('SVG exported.');
			}));
		menu.showAtMouseEvent(event);
	});
	exportBtn.createSpan({ cls: 'mathgraph-button-caret', text: '▾' });

	const scroll = block.createDiv({ cls: 'mathgraph-graph-scroll' });
	const inner = scroll.createDiv({ cls: 'mathgraph-rendered-inner' });
	const img = inner.createEl('img');
	img.setAttr('src', result.dataUrl);
	img.setAttr('alt', spec.title || GRAPH_TYPE_LABELS[spec.type] || 'Math graph');
	img.addClass('mathgraph-image');

	if (actions.onRotateView) {
		bind3DInteraction(img, spec, svgText, actions.onRotateView, actions.onMovePoint);
	} else if (actions.onMovePoint) {
		bindPointDrag(img, spec, svgText, actions.onMovePoint);
	}

	bindRenderedGraphLayoutScale(block, spec, svgText);
}

interface FastSvgCalibration {
	svgWidth: number;
	svgHeight: number;
	plotLeft: number;
	plotTop: number;
	plotWidth: number;
	plotHeight: number;
	xmin: number;
	xmax: number;
	ymin: number;
	ymax: number;
}

/** Read the plot-area calibration the fast SVG renderer embeds in its root element. */
function parseFastSvgCalibration(svgText: string): FastSvgCalibration | null {
	const size = /<svg[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"/.exec(svgText);
	const plot = /data-mg-plot="([^"]+)"/.exec(svgText);
	const window = /data-mg-window="([^"]+)"/.exec(svgText);
	if (!size || !plot || !window) {
		return null;
	}
	const plotParts = plot[1].split(',').map(Number);
	const windowParts = window[1].split(',').map(Number);
	if (plotParts.length !== 4 || windowParts.length !== 4
		|| plotParts.some(v => !Number.isFinite(v)) || windowParts.some(v => !Number.isFinite(v))) {
		return null;
	}
	const cal: FastSvgCalibration = {
		svgWidth: Number.parseFloat(size[1]),
		svgHeight: Number.parseFloat(size[2]),
		plotLeft: plotParts[0],
		plotTop: plotParts[1],
		plotWidth: plotParts[2],
		plotHeight: plotParts[3],
		xmin: windowParts[0],
		xmax: windowParts[1],
		ymin: windowParts[2],
		ymax: windowParts[3],
	};
	if (cal.plotWidth <= 0 || cal.plotHeight <= 0 || cal.xmax <= cal.xmin || cal.ymax <= cal.ymin) {
		return null;
	}
	return cal;
}

const POINT_HIT_RADIUS_PX = 14;

interface NumericGraphPoint {
	index: number;
	x: number;
	y: number;
	z: number;
}

/** Resolve the spec's points to numbers, freshly, so drags track live positions. */
function resolveNumericGraphPoints(spec: GraphSpec): NumericGraphPoint[] {
	const result: NumericGraphPoint[] = [];
	(spec.points ?? []).forEach((point, index) => {
		const resolved = resolveGraphPointCoordinates(spec, point);
		if (!resolved) {
			return;
		}
		const x = parseBoundToNumber(resolved.x);
		const y = parseBoundToNumber(resolved.y);
		const z = parseBoundToNumber(resolved.z ?? '0') ?? 0;
		if (x === null || y === null) {
			return;
		}
		result.push({ index, x, y, z });
	});
	return result;
}

/** Hold-and-drag point markers on 2D fast-SVG graphs. */
function bindPointDrag(
	img: HTMLElement,
	spec: GraphSpec,
	svgText: string,
	movePoint: (pointIndex: number, x: number, y: number, phase: 'preview' | 'commit') => void,
): void {
	const cal = parseFastSvgCalibration(svgText);
	if (!cal) {
		return;
	}

	if (resolveNumericGraphPoints(spec).length === 0) {
		return;
	}

	const toClient = (wx: number, wy: number, rect: DOMRect) => {
		const sx = rect.width / cal.svgWidth;
		const sy = rect.height / cal.svgHeight;
		const localX = cal.plotLeft + ((wx - cal.xmin) / (cal.xmax - cal.xmin)) * cal.plotWidth;
		const localY = cal.plotTop + cal.plotHeight - ((wy - cal.ymin) / (cal.ymax - cal.ymin)) * cal.plotHeight;
		return { x: rect.left + localX * sx, y: rect.top + localY * sy };
	};

	const toWorld = (clientX: number, clientY: number, rect: DOMRect) => {
		const sx = rect.width / cal.svgWidth;
		const sy = rect.height / cal.svgHeight;
		const localX = (clientX - rect.left) / sx;
		const localY = (clientY - rect.top) / sy;
		const x = cal.xmin + ((localX - cal.plotLeft) / cal.plotWidth) * (cal.xmax - cal.xmin);
		const y = cal.ymax - ((localY - cal.plotTop) / cal.plotHeight) * (cal.ymax - cal.ymin);
		return {
			x: Math.min(cal.xmax, Math.max(cal.xmin, x)),
			y: Math.min(cal.ymax, Math.max(cal.ymin, y)),
		};
	};

	const hitTest = (clientX: number, clientY: number): number | null => {
		const rect = img.getBoundingClientRect();
		let best: number | null = null;
		let bestDistance = POINT_HIT_RADIUS_PX;
		for (const point of resolveNumericGraphPoints(spec)) {
			const client = toClient(point.x, point.y, rect);
			const distance = Math.hypot(client.x - clientX, client.y - clientY);
			if (distance <= bestDistance) {
				best = point.index;
				bestDistance = distance;
			}
		}
		return best;
	};

	let activeIndex: number | null = null;
	let moved = false;
	let lastWorld: { x: number; y: number } | null = null;
	let frame: number | null = null;

	img.addEventListener('pointerdown', event => {
		if (event.button !== 0) {
			return;
		}
		const index = hitTest(event.clientX, event.clientY);
		if (index === null) {
			return;
		}
		activeIndex = index;
		moved = false;
		lastWorld = null;
		img.setPointerCapture(event.pointerId);
		img.addClass('mathgraph-point-dragging');
		event.preventDefault();
	});

	img.addEventListener('pointermove', event => {
		if (activeIndex === null) {
			img.toggleClass('mathgraph-point-hover', hitTest(event.clientX, event.clientY) !== null);
			return;
		}
		const rect = img.getBoundingClientRect();
		lastWorld = toWorld(event.clientX, event.clientY, rect);
		moved = true;
		if (frame === null) {
			frame = window.requestAnimationFrame(() => {
				frame = null;
				if (activeIndex !== null && lastWorld) {
					movePoint(activeIndex, lastWorld.x, lastWorld.y, 'preview');
				}
			});
		}
		event.preventDefault();
	});

	const endDrag = (event: PointerEvent) => {
		if (activeIndex === null) {
			return;
		}
		const index = activeIndex;
		activeIndex = null;
		img.removeClass('mathgraph-point-dragging');
		try {
			img.releasePointerCapture(event.pointerId);
		} catch {
			// pointer capture may already be gone
		}
		if (frame !== null) {
			window.cancelAnimationFrame(frame);
			frame = null;
		}
		if (moved && lastWorld) {
			movePoint(index, lastWorld.x, lastWorld.y, 'commit');
		}
	};

	img.addEventListener('pointerup', endDrag);
	img.addEventListener('pointercancel', endDrag);
	img.addEventListener('dragstart', event => event.preventDefault());
}

const ROTATE_DEG_PER_PX_AZIMUTH = 0.5;
const ROTATE_DEG_PER_PX_ELEVATION = 0.35;

interface FastSvg3dCalibration {
	svgWidth: number;
	svgHeight: number;
	xMin: number;
	xMax: number;
	yMin: number;
	yMax: number;
	zMin: number;
	zMax: number;
	azimuth: number;
	elevation: number;
	ax: number;
	bx: number;
	ay: number;
	by: number;
}

/** Read the 3D projection calibration the fast SVG renderer embeds in its root element. */
function parseFastSvg3dCalibration(svgText: string): FastSvg3dCalibration | null {
	const size = /<svg[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"/.exec(svgText);
	const data = /data-mg-3d="([^"]+)"/.exec(svgText);
	if (!size || !data) {
		return null;
	}
	const parts = data[1].split(',').map(Number);
	if (parts.length !== 12 || parts.some(value => !Number.isFinite(value))) {
		return null;
	}
	const [xMin, xMax, yMin, yMax, zMin, zMax, azimuth, elevation, ax, bx, ay, by] = parts;
	if (xMax <= xMin || yMax <= yMin || ax === 0 || ay === 0) {
		return null;
	}
	return {
		svgWidth: Number.parseFloat(size[1]),
		svgHeight: Number.parseFloat(size[2]),
		xMin, xMax, yMin, yMax, zMin, zMax, azimuth, elevation, ax, bx, ay, by,
	};
}

/**
 * 3D interaction: plain drag rotates the view; dragging a point marker moves the point
 * in the x/y plane. Holding Shift always rotates — the escape hatch when a point sits
 * under the cursor.
 */
function bind3DInteraction(
	img: HTMLElement,
	spec: GraphSpec,
	svgText: string,
	rotate: (azimuthDelta: number, elevationDelta: number, phase: 'preview' | 'commit') => void,
	movePoint?: (pointIndex: number, x: number, y: number, phase: 'preview' | 'commit') => void,
): void {
	img.addClass('mathgraph-rotatable');
	img.setAttr('title', movePoint
		? 'Drag to rotate · drag a point to move it (hold Shift to always rotate)'
		: 'Drag to rotate');

	const cal = parseFastSvg3dCalibration(svgText);
	const canDragPoints = Boolean(cal && movePoint);
	const azimuthRad = cal ? (cal.azimuth * Math.PI) / 180 : 0;
	const elevationRad = cal ? (cal.elevation * Math.PI) / 180 : 0;
	const cosA = Math.cos(azimuthRad);
	const sinA = Math.sin(azimuthRad);
	const cosE = Math.cos(elevationRad);
	const sinE = Math.sin(elevationRad);
	const spanX = cal ? (cal.xMax - cal.xMin || 1) : 1;
	const spanY = cal ? (cal.yMax - cal.yMin || 1) : 1;
	const spanZ = cal ? (cal.zMax - cal.zMin || 1) : 1;

	const normX = (x: number) => (cal ? ((x - cal.xMin) / spanX) * 2 - 1 : 0);
	const normY = (y: number) => (cal ? ((y - cal.yMin) / spanY) * 2 - 1 : 0);
	const normZ = (z: number) => (cal ? ((z - cal.zMin) / spanZ) * 2 - 1 : 0);
	const denormX = (nx: number) => (cal ? cal.xMin + ((nx + 1) / 2) * spanX : 0);
	const denormY = (ny: number) => (cal ? cal.yMin + ((ny + 1) / 2) * spanY : 0);

	const worldToSvg = (x: number, y: number, z: number) => {
		const nx = normX(x);
		const ny = normY(y);
		const nz = normZ(z);
		const px = nx * cosA - ny * sinA;
		const py = -nz * cosE + (nx * sinA + ny * cosA) * sinE;
		return { x: (cal?.ax ?? 1) * px + (cal?.bx ?? 0), y: (cal?.ay ?? 1) * py + (cal?.by ?? 0) };
	};

	/** Invert the projection in the x/y plane, holding the point's current z fixed. */
	const svgToWorldXY = (svgX: number, svgY: number, current: NumericGraphPoint) => {
		const px = (svgX - (cal?.bx ?? 0)) / (cal?.ax ?? 1);
		const py = (svgY - (cal?.by ?? 0)) / (cal?.ay ?? 1);
		const nz = normZ(current.z);
		// Near a side view the depth axis is edge-on — keep the current depth instead of exploding.
		const depth = Math.abs(sinE) >= 0.15
			? (py + nz * cosE) / sinE
			: normX(current.x) * sinA + normY(current.y) * cosA;
		const nx = Math.max(-1, Math.min(1, px * cosA + depth * sinA));
		const ny = Math.max(-1, Math.min(1, -px * sinA + depth * cosA));
		return { x: denormX(nx), y: denormY(ny) };
	};

	const hitTestPoint = (clientX: number, clientY: number): NumericGraphPoint | null => {
		if (!canDragPoints || !cal) {
			return null;
		}
		const rect = img.getBoundingClientRect();
		const scaleX = rect.width / cal.svgWidth;
		const scaleY = rect.height / cal.svgHeight;
		let best: NumericGraphPoint | null = null;
		let bestDistance = POINT_HIT_RADIUS_PX;
		for (const point of resolveNumericGraphPoints(spec)) {
			const svg = worldToSvg(point.x, point.y, point.z);
			const distance = Math.hypot(
				rect.left + svg.x * scaleX - clientX,
				rect.top + svg.y * scaleY - clientY,
			);
			if (distance <= bestDistance) {
				best = point;
				bestDistance = distance;
			}
		}
		return best;
	};

	let mode: 'rotate' | 'point' | null = null;
	let activeIndex = 0;
	let moved = false;
	let lastX = 0;
	let lastY = 0;
	let pendingAzimuth = 0;
	let pendingElevation = 0;
	let lastWorld: { x: number; y: number } | null = null;
	let frame: number | null = null;

	const flushPreview = () => {
		frame = null;
		if (mode === 'rotate' && (pendingAzimuth !== 0 || pendingElevation !== 0)) {
			rotate(pendingAzimuth, pendingElevation, 'preview');
			pendingAzimuth = 0;
			pendingElevation = 0;
		} else if (mode === 'point' && lastWorld && movePoint) {
			movePoint(activeIndex, lastWorld.x, lastWorld.y, 'preview');
		}
	};

	img.addEventListener('pointerdown', event => {
		if (event.button !== 0) {
			return;
		}
		const hit = event.shiftKey ? null : hitTestPoint(event.clientX, event.clientY);
		if (hit && movePoint) {
			mode = 'point';
			activeIndex = hit.index;
			img.addClass('mathgraph-point-dragging');
		} else {
			mode = 'rotate';
			img.addClass('mathgraph-rotating');
		}
		moved = false;
		lastWorld = null;
		lastX = event.clientX;
		lastY = event.clientY;
		img.setPointerCapture(event.pointerId);
		event.preventDefault();
	});

	img.addEventListener('pointermove', event => {
		if (mode === null) {
			if (canDragPoints) {
				img.toggleClass(
					'mathgraph-point-hover',
					!event.shiftKey && hitTestPoint(event.clientX, event.clientY) !== null,
				);
			}
			return;
		}

		if (mode === 'rotate') {
			const dx = event.clientX - lastX;
			const dy = event.clientY - lastY;
			lastX = event.clientX;
			lastY = event.clientY;
			if (dx === 0 && dy === 0) {
				return;
			}
			moved = true;
			// Grab metaphor: dragging right pulls the front of the graph to the right.
			pendingAzimuth += -dx * ROTATE_DEG_PER_PX_AZIMUTH;
			pendingElevation += dy * ROTATE_DEG_PER_PX_ELEVATION;
		} else if (cal) {
			const current = resolveNumericGraphPoints(spec).find(p => p.index === activeIndex);
			if (!current) {
				return;
			}
			const rect = img.getBoundingClientRect();
			const svgX = (event.clientX - rect.left) / (rect.width / cal.svgWidth);
			const svgY = (event.clientY - rect.top) / (rect.height / cal.svgHeight);
			lastWorld = svgToWorldXY(svgX, svgY, current);
			moved = true;
		}

		if (frame === null) {
			frame = window.requestAnimationFrame(flushPreview);
		}
		event.preventDefault();
	});

	const endDrag = (event: PointerEvent) => {
		if (mode === null) {
			return;
		}
		const endedMode = mode;
		mode = null;
		img.removeClass('mathgraph-rotating');
		img.removeClass('mathgraph-point-dragging');
		try {
			img.releasePointerCapture(event.pointerId);
		} catch {
			// pointer capture may already be gone
		}
		if (frame !== null) {
			window.cancelAnimationFrame(frame);
			frame = null;
		}
		if (!moved) {
			return;
		}
		if (endedMode === 'rotate') {
			rotate(pendingAzimuth, pendingElevation, 'commit');
			pendingAzimuth = 0;
			pendingElevation = 0;
		} else if (lastWorld && movePoint) {
			movePoint(activeIndex, lastWorld.x, lastWorld.y, 'commit');
		}
	};

	img.addEventListener('pointerup', endDrag);
	img.addEventListener('pointercancel', endDrag);
	img.addEventListener('dragstart', event => event.preventDefault());
}
