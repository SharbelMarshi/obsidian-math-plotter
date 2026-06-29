import { Notice } from 'obsidian';
import type { MarkdownPostProcessorContext } from 'obsidian';
import type MathGraphStudioPlugin from '../main';
import { GraphBuilderModal } from './graphBuilderModal';
import {
	type GraphBlockLocation,
	replaceGraphBlockBody,
	removeGraphBlock,
} from './GraphBlockUpdater';
import {
	defaultInlineFields,
	inlineFieldsFromSpec,
	INLINE_GRAPH_TYPE_LABELS,
	specFromInlineFields,
	validateInlineFields,
	type InlineBuilderFields,
	type InlineGraphType,
} from './inlineGraphDefaults';
import { placeholderForGraphType } from './functionPlaceholders';
import { INLINE_SIZE_PRESET_LABELS } from './graphSize';
import { decorateMathGraphRoot } from './uiStyle';

export interface InlineGraphBuilderOptions {
	plugin: MathGraphStudioPlugin;
	ctx: MarkdownPostProcessorContext;
	location: GraphBlockLocation;
}

export function renderInlineGraphBuilder(
	el: HTMLElement,
	options: InlineGraphBuilderOptions,
): void {
	el.empty();
	el.addClass('mathgraph-processor-root');
	decorateMathGraphRoot(el, options.plugin.settings);

	const card = el.createDiv({ cls: 'mathgraph-inline-builder' });
	card.createDiv({ cls: 'mathgraph-inline-builder-header', text: 'Create Math Graph' });
	card.createDiv({
		cls: 'mathgraph-inline-builder-subtitle',
		text: 'Quick setup — use More Options for advanced settings.',
	});

	const fields: InlineBuilderFields = defaultInlineFields('function2d');

	const grid = card.createDiv({ cls: 'mathgraph-field-grid mathgraph-inline-builder-grid' });

	const typeRow = grid.createDiv({ cls: 'mathgraph-field' });
	typeRow.createEl('label', { text: 'Graph type', cls: 'mathgraph-label' });
	const typeSelect = typeRow.createEl('select', { cls: 'mathgraph-select' });
	for (const [value, label] of Object.entries(INLINE_GRAPH_TYPE_LABELS)) {
		typeSelect.createEl('option', { text: label, value });
	}
	typeSelect.value = fields.type;

	const sizeRow = grid.createDiv({ cls: 'mathgraph-field' });
	sizeRow.createEl('label', { text: 'Graph size (LaTeX)', cls: 'mathgraph-label' });
	const sizeSelect = sizeRow.createEl('select', { cls: 'mathgraph-select' });
	for (const [value, label] of Object.entries(INLINE_SIZE_PRESET_LABELS) as [string, string][]) {
		sizeSelect.createEl('option', { text: label, value });
	}
	sizeSelect.value = fields.sizePreset;

	const exprRow = grid.createDiv({ cls: 'mathgraph-field mathgraph-field-wide' });
	const exprLabel = exprRow.createEl('label', { cls: 'mathgraph-label' });
	exprLabel.setText('Function');
	const exprInput = exprRow.createEl('input', {
		type: 'text',
		cls: 'mathgraph-input',
	});
	exprInput.placeholder = placeholderForGraphType(fields.type);
	exprInput.value = fields.expression;

	const titleRow = grid.createDiv({ cls: 'mathgraph-field mathgraph-field-wide' });
	titleRow.createEl('label', { text: 'Title', cls: 'mathgraph-label' });
	const titleInput = titleRow.createEl('input', {
		type: 'text',
		cls: 'mathgraph-input',
	});
	titleInput.value = fields.title;

	const rangeGrid = grid.createDiv({ cls: 'mathgraph-inline-range-grid' });

	const xMinInput = createRangeInput(rangeGrid, 'x min', fields.xMin);
	const xMaxInput = createRangeInput(rangeGrid, 'x max', fields.xMax);
	const yMinInput = createRangeInput(rangeGrid, 'y min', fields.yMin);
	const yMaxInput = createRangeInput(rangeGrid, 'y max', fields.yMax);
	const zMinInput = createRangeInput(rangeGrid, 'z min', fields.zMin);
	const zMaxInput = createRangeInput(rangeGrid, 'z max', fields.zMax);
	const paramRow = grid.createDiv({ cls: 'mathgraph-field' });
	paramRow.createEl('label', { text: 'Parameter t', cls: 'mathgraph-label' });
	const paramInput = paramRow.createEl('input', {
		type: 'text',
		cls: 'mathgraph-input',
	});
	paramInput.value = fields.paramT;

	const errorEl = card.createDiv({ cls: 'mathgraph-inline-error' });
	errorEl.hide();

	const zMinWrap = zMinInput.closest('.mathgraph-field') as HTMLElement;
	const zMaxWrap = zMaxInput.closest('.mathgraph-field') as HTMLElement;

	function applyTypeDefaults(type: InlineGraphType): void {
		const defaults = defaultInlineFields(type);
		exprLabel.setText(type === 'pde' || type === 'ode' ? 'Solution' : 'Function');
		exprInput.placeholder = placeholderForGraphType(type);
		exprInput.value = defaults.expression;
		sizeSelect.value = defaults.sizePreset;
		titleInput.value = defaults.title;
		xMinInput.value = defaults.xMin;
		xMaxInput.value = defaults.xMax;
		yMinInput.value = defaults.yMin;
		yMaxInput.value = defaults.yMax;
		zMinInput.value = defaults.zMin;
		zMaxInput.value = defaults.zMax;
		paramInput.value = defaults.paramT;
		updateVisibility(type);
	}

	function updateVisibility(type: InlineGraphType): void {
		const show3d = type === 'surface3d' || type === 'pde';
		zMinWrap.toggleVisibility(show3d);
		zMaxWrap.toggleVisibility(show3d);
		paramRow.toggleVisibility(type === 'pde');
	}

	function readFields(): InlineBuilderFields {
		return {
			type: typeSelect.value as InlineGraphType,
			sizePreset: sizeSelect.value as InlineBuilderFields['sizePreset'],
			expression: exprInput.value,
			title: titleInput.value,
			xMin: xMinInput.value,
			xMax: xMaxInput.value,
			yMin: yMinInput.value,
			yMax: yMaxInput.value,
			zMin: zMinInput.value,
			zMax: zMaxInput.value,
			paramT: paramInput.value,
		};
	}

	typeSelect.addEventListener('change', () => {
		applyTypeDefaults(typeSelect.value as InlineGraphType);
		errorEl.hide();
	});

	updateVisibility(fields.type);

	const actions = card.createDiv({ cls: 'mathgraph-inline-builder-actions' });

	const insertBtn = actions.createEl('button', {
		text: 'Insert Graph',
		cls: 'mathgraph-button mathgraph-button-primary',
	});
	const moreBtn = actions.createEl('button', {
		text: 'More Options',
		cls: 'mathgraph-button mathgraph-button-secondary',
	});
	const cancelBtn = actions.createEl('button', {
		text: 'Cancel',
		cls: 'mathgraph-button mathgraph-button-secondary',
	});

	insertBtn.addEventListener('click', () => {
		void insertFromInline();
	});

	moreBtn.addEventListener('click', () => {
		const current = readFields();
		const validationError = validateInlineFields(current);
		const seedSpec = validationError
			? specFromInlineFields(defaultInlineFields(current.type))
			: specFromInlineFields(current);

		new GraphBuilderModal(options.plugin.app, options.plugin, {
			mode: 'edit',
			spec: seedSpec,
			location: options.location,
		}).open();
	});

	cancelBtn.addEventListener('click', () => {
		void removeGraphBlock(options.plugin.app, options.location)
			.then(() => new Notice('Graph block removed.'))
			.catch(err => {
				new Notice(err instanceof Error ? err.message : 'Could not remove block.');
			});
	});

	async function insertFromInline(): Promise<void> {
		const current = readFields();
		const validationError = validateInlineFields(current);
		if (validationError) {
			errorEl.setText(validationError);
			errorEl.show();
			return;
		}

		errorEl.hide();
		const spec = specFromInlineFields(current);

		try {
			await replaceGraphBlockBody(options.plugin.app, options.location, spec);
			new Notice('Graph inserted.');
		} catch (err) {
			new Notice(err instanceof Error ? err.message : 'Could not insert graph.');
		}
	}
}

function createRangeInput(
	parent: HTMLElement,
	label: string,
	value: string,
): HTMLInputElement {
	const row = parent.createDiv({ cls: 'mathgraph-field' });
	row.createEl('label', { text: label, cls: 'mathgraph-label' });
	const input = row.createEl('input', {
		type: 'text',
		cls: 'mathgraph-input',
	});
	input.value = value;
	return input;
}
