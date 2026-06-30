import { Notice } from 'obsidian';
import type { RenderImageResult } from '../render/types';
import {
	clampDisplayScale,
	ensureGraphSize,
	formatDisplayScaleLabel,
} from './graphSize';
import type { GraphSpec } from './graphSpec';
import { GRAPH_TYPE_LABELS } from './graphSpec';
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
	/** When set, appended to render error details (debug mode). */
	debugSource?: string;
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
	}

	makeButton('Export', () => {
		downloadSvg(svgText, el.ownerDocument, `${spec.title || 'math-graph'}.svg`);
		new Notice('SVG exported.');
	});

	makeButton('Export PNG', () => {
		void svgToPng(svgText, el.ownerDocument).then(blob => {
			downloadBlob(blob, `${spec.title || 'math-graph'}.png`, el.ownerDocument);
			new Notice('PNG exported.');
		}).catch(err => {
			new Notice(err instanceof Error ? err.message : 'PNG export failed.');
		});
	});

	const scroll = block.createDiv({ cls: 'mathgraph-graph-scroll' });
	const inner = scroll.createDiv({ cls: 'mathgraph-rendered-inner' });
	const img = inner.createEl('img');
	img.setAttr('src', result.dataUrl);
	img.setAttr('alt', spec.title || GRAPH_TYPE_LABELS[spec.type] || 'Math graph');
	img.addClass('mathgraph-image');

	bindRenderedGraphLayoutScale(block, spec, svgText);
}
