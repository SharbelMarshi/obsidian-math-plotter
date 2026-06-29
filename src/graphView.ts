import { Notice } from 'obsidian';
import type { RenderImageResult } from '../render/types';
import {
	clampDisplayScale,
	ensureGraphSize,
	formatDisplayScaleLabel,
	graphDisplayCssClasses,
	resolveDisplayScale,
} from './graphSize';
import type { GraphSpec } from './graphSpec';
import { GRAPH_TYPE_LABELS } from './graphSpec';
import type { RenderedGraphFrame } from './uiStyle';
import { graphFrameClassName } from './uiStyle';

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

async function svgToPng(svgText: string): Promise<Blob> {
	const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
	const url = URL.createObjectURL(svgBlob);
	try {
		const img = new Image();
		img.src = url;
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error('Could not load SVG image.'));
		});

		const canvas = document.createElement('canvas');
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
	onEditSize?: () => void;
	onRefresh?: () => void;
	onDisplayScaleChange?: (newScale: number) => void | Promise<void>;
	frame?: RenderedGraphFrame;
	warnings?: string[];
}

export interface GraphErrorAction {
	label: string;
	onClick: () => void;
	primary?: boolean;
	danger?: boolean;
}

export interface GraphErrorOptions {
	details?: string;
	actions?: GraphErrorAction[];
	onRetry?: () => void;
}

export function applyRenderedGraphDisplayScale(container: HTMLElement, spec: GraphSpec): void {
	const scale = resolveDisplayScale(spec);
	const inner = container.querySelector('.mathgraph-rendered-inner');
	if (inner instanceof HTMLElement) {
		inner.style.setProperty('--mathgraph-display-scale', String(scale));
	}
	const label = container.querySelector('.mathgraph-scale-label');
	if (label) {
		label.setText(formatDisplayScaleLabel(scale));
	}
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
		appendGraphError(el, result.error ?? 'Render failed.', {
			details: result.rawLog,
			onRetry: actions.onRefresh,
		});
		return;
	}

	const size = ensureGraphSize(spec);
	const frame = actions.frame ?? 'none';
	const block = el.createDiv({
		cls: `mathgraph-rendered-container ${graphFrameClassName(frame)} ${graphDisplayCssClasses(spec)}`,
	});

	if (spec.title || spec.equation) {
		const header = block.createDiv({ cls: 'mathgraph-graph-caption' });
		if (spec.title) {
			header.createDiv({ cls: 'mathgraph-title', text: spec.title });
		}
		if (spec.equation) {
			header.createDiv({ cls: 'mathgraph-equation', text: spec.equation });
		}
	}

	for (const warning of actions.warnings ?? []) {
		block.createDiv({ cls: 'mathgraph-graph-warning', text: warning });
	}

	const imageWrap = block.createDiv({ cls: 'mathgraph-image-wrap' });
	const toolbar = imageWrap.createDiv({ cls: 'mathgraph-hover-actions' });

	const makeButton = (label: string, handler: () => void, extraClass = '') => {
		const cls = ['mathgraph-button', 'mathgraph-button-secondary', extraClass].filter(Boolean).join(' ');
		const btn = toolbar.createEl('button', { text: label, cls });
		btn.addEventListener('click', handler);
		return btn;
	};

	if (actions.onEdit) {
		makeButton('Edit', actions.onEdit);
	}
	if (actions.onEditSize) {
		makeButton('Edit size', actions.onEditSize);
	}
	if (actions.onRefresh) {
		makeButton('Refresh', actions.onRefresh);
	}

	if (actions.onDisplayScaleChange) {
		const scaleGroup = toolbar.createDiv({ cls: 'mathgraph-scale-controls' });
		scaleGroup.setAttr('aria-label', 'Display scale (no recompile)');

		const minusBtn = scaleGroup.createEl('button', {
			text: '−',
			cls: 'mathgraph-button mathgraph-button-secondary mathgraph-scale-btn',
		});
		minusBtn.setAttr('aria-label', 'Decrease display scale');
		const scaleLabel = scaleGroup.createEl('button', {
			text: formatDisplayScaleLabel(size.displayScale ?? 1),
			cls: 'mathgraph-button mathgraph-button-secondary mathgraph-scale-label',
		});
		scaleLabel.setAttr('aria-label', 'Reset display scale to 100%');
		scaleLabel.setAttr('title', 'Display scale — visual zoom in Obsidian (no LaTeX recompile)');
		const plusBtn = scaleGroup.createEl('button', {
			text: '+',
			cls: 'mathgraph-button mathgraph-button-secondary mathgraph-scale-btn',
		});
		plusBtn.setAttr('aria-label', 'Increase display scale');

		const changeScale = (delta: number) => {
			const current = clampDisplayScale(size.displayScale ?? 1);
			const next = clampDisplayScale(current + delta);
			if (next === current) {
				return;
			}
			void Promise.resolve(actions.onDisplayScaleChange!(next)).then(() => {
				size.displayScale = next;
				applyRenderedGraphDisplayScale(block, spec);
			});
		};

		minusBtn.addEventListener('click', () => changeScale(-0.1));
		plusBtn.addEventListener('click', () => changeScale(0.1));
		scaleLabel.addEventListener('click', () => {
			void Promise.resolve(actions.onDisplayScaleChange!(1)).then(() => {
				size.displayScale = 1;
				applyRenderedGraphDisplayScale(block, spec);
			});
		});
	}

	makeButton('Export', () => {
		downloadSvg(result.svgText!, el.ownerDocument, `${spec.title || 'math-graph'}.svg`);
		new Notice('SVG exported.');
	});

	makeButton('Export PNG', () => {
		void svgToPng(result.svgText!).then(blob => {
			downloadBlob(blob, `${spec.title || 'math-graph'}.png`, el.ownerDocument);
			new Notice('PNG exported.');
		}).catch(err => {
			new Notice(err instanceof Error ? err.message : 'PNG export failed.');
		});
	});

	makeButton('Copy TikZ', () => {
		void navigator.clipboard.writeText(tikzSource).then(() => {
			new Notice('TikZ copied.');
		}).catch(() => {
			new Notice('Could not copy TikZ.');
		});
	});

	const inner = imageWrap.createDiv({ cls: 'mathgraph-rendered-inner mathgraph-display-scaled' });
	inner.style.setProperty('--mathgraph-display-scale', String(resolveDisplayScale(spec)));

	const container = inner.createDiv({ cls: 'mathgraph-graph-output' });
	const img = container.createEl('img');
	img.setAttr('src', result.dataUrl);
	img.setAttr('alt', spec.title || GRAPH_TYPE_LABELS[spec.type] || 'Math graph');
	img.addClass('mathgraph-image');
}
