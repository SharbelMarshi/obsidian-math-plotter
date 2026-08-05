import { App, Menu, Modal, Notice } from 'obsidian';
import type MathGraphStudioPlugin from '../main';
import { replaceGraphBlockBody, type GraphBlockLocation } from './GraphBlockUpdater';
import { placeholderForGraphType } from './functionPlaceholders';
import {
	defaultGraphSpec,
	getUserFunction,
	GRAPH_TYPE_LABELS,
	hydrateGraphSpec,
	setUserFunction,
	type GraphPoint,
	type GraphSpec,
	type GraphType,
} from './graphSpec';
import { graphUses3dPoints } from './graphPointsTikz';
import { isHTMLElement } from './domUtils';
import {
	analyzeGraphPoint,
	attachComputedCoordinates,
	graphSupportsAutoComputeY,
	graphSupportsAutoComputeZ,
	summarizeGraphPointWarnings,
} from './graphPointResolution';
import {
	applyPresetToGraphSize,
	clampDisplayScale,
	DISPLAY_SCALE_STEP,
	ensureGraphSize,
	formatDisplayScaleLabel,
	GRAPH_SIZE_PRESET_LABELS,
	validateGraphSize,
	type AspectMode,
	type GraphSizePreset,
} from './graphSize';
import { ASPECT_MODE_LABELS, graphUses2dAspectRatio } from './graphAspectLayout';
import { surfaceZRangeClipWarning } from './graphRangeValidation';
import { graphSupportsGridToggle, gridEnabledForGraph } from './graphGridStyle';
import { graphSupportsSurfaceStyleControl, hydrateGraphStyle, type SurfaceStyle } from './graphPlotStyle';
import {
	clampAxisLineWidth,
	clampLabelFontSize,
	resolveAxisLineWidth,
	resolveLabelFontSize,
} from './renderStyleConfig';
import { mathgraphUiClassName } from './uiStyle';

export interface GraphBuilderModalOptions {
	mode: 'insert' | 'edit';
	spec?: GraphSpec;
	location?: GraphBlockLocation;
	onInsert?: (spec: GraphSpec) => Promise<void>;
}

type BuilderSection = 'equation' | 'ranges' | 'style' | 'size' | 'points';

export class GraphBuilderModal extends Modal {
	private spec: GraphSpec;
	private readonly options: GraphBuilderModalOptions;
	private shellEl!: HTMLElement;
	private bodyEl!: HTMLElement;
	private sections = new Map<BuilderSection, HTMLElement>();
	private pointWarningsEl: HTMLElement | null = null;

	constructor(app: App, private plugin: MathGraphStudioPlugin, options: GraphBuilderModalOptions) {
		super(app);
		this.options = options;
		this.spec = options.spec
			? hydrateGraphSpec(structuredClone(options.spec), this.plugin.settings)
			: defaultGraphSpec('function2d', this.plugin.settings);
	}

	onOpen(): void {
		const { contentEl, titleEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass('mathgraph-modal-container');
		titleEl.hide();

		this.shellEl = contentEl.createDiv({
			cls: `mathgraph-modal-shell mathgraph-modal ${mathgraphUiClassName()}`,
		});

		this.renderHeader();
		this.bodyEl = this.shellEl.createDiv({ cls: 'mathgraph-modal-body-scroll' });
		this.renderFooter();
		this.renderForm();
	}

	private renderHeader(): void {
		const header = this.shellEl.createDiv({ cls: 'mathgraph-modal-header' });
		const textWrap = header.createDiv({ cls: 'mathgraph-modal-header-text' });
		textWrap.createDiv({ cls: 'mathgraph-modal-title', text: 'Math Plotter' });
	}

	private renderFooter(): void {
		const footer = this.shellEl.createDiv({ cls: 'mathgraph-modal-footer' });
		footer.createEl('button', {
			type: 'button',
			text: 'Cancel',
			cls: 'mathgraph-button mathgraph-button-secondary',
		}).addEventListener('click', () => this.close());

		const primaryLabel = this.options.mode === 'edit' ? 'Save Graph' : 'Insert Graph';
		footer.createEl('button', {
			type: 'button',
			text: primaryLabel,
			cls: 'mathgraph-button mathgraph-button-primary',
		}).addEventListener('click', () => void this.submit());
	}

	private renderForm(): void {
		const scrollTop = this.bodyEl.scrollTop;
		this.bodyEl.empty();
		this.sections.clear();
		this.pointWarningsEl = null;

		this.renderEquationSection(this.createSection('equation'));
		this.renderRangesSection(this.createSection('ranges', 'Ranges'));
		this.renderStyleSection(this.createSection('style', 'Style'));
		this.renderSizeSection(this.createSection('size', 'Size'));
		if (this.spec.type !== 'data') {
			this.renderPointsSection(this.createSection('points', 'Points'));
		}

		this.bodyEl.scrollTop = scrollTop;
	}

	private createSection(id: BuilderSection, title?: string): HTMLElement {
		const section = this.bodyEl.createDiv({ cls: 'mathgraph-form-section' });
		section.dataset.section = id;
		if (title) {
			section.createDiv({ cls: 'mathgraph-form-section-title', text: title });
		}
		this.sections.set(id, section);
		return section;
	}

	private formGrid(parent: HTMLElement): HTMLElement {
		return parent.createDiv({ cls: 'mathgraph-form-grid' });
	}

	private formRow(
		parent: HTMLElement,
		label: string,
		options?: { help?: string; wide?: boolean },
	): HTMLElement {
		const row = parent.createDiv({
			cls: `mathgraph-form-row${options?.wide ? ' mathgraph-form-row-wide' : ''}`,
		});
		row.createEl('label', { cls: 'mathgraph-field-label', text: label });
		if (options?.help) {
			row.createEl('div', { cls: 'mathgraph-field-help', text: options.help });
		}
		return row.createDiv({ cls: 'mathgraph-field' });
	}

	private formText(
		parent: HTMLElement,
		label: string,
		value: string,
		onChange: (value: string) => void,
		options?: { placeholder?: string; help?: string; wide?: boolean },
	): void {
		const field = this.formRow(parent, label, options);
		const input = field.createEl('input', {
			type: 'text',
			cls: 'mathgraph-input',
			value,
		});
		if (options?.placeholder) {
			input.placeholder = options.placeholder;
		}
		input.addEventListener('input', () => onChange(input.value));
	}

	/** Wide text input with the graph-type chooser chip attached to its right edge. */
	private formPrimaryText(
		parent: HTMLElement,
		label: string,
		value: string,
		onChange: (value: string) => void,
		placeholder?: string,
	): void {
		const field = this.formRow(parent, label, { wide: true });
		const group = field.createDiv({ cls: 'mathgraph-fn-group' });
		const input = group.createEl('input', {
			type: 'text',
			cls: 'mathgraph-input mathgraph-fn-input',
			value,
		});
		if (placeholder) {
			input.placeholder = placeholder;
		}
		input.addEventListener('input', () => onChange(input.value));
		this.renderTypeChip(group);
	}

	private renderTypeChip(parent: HTMLElement): void {
		const chip = parent.createEl('button', {
			type: 'button',
			cls: 'mathgraph-type-chip',
			attr: {
				'aria-label': 'Change graph type',
				'aria-haspopup': 'menu',
				title: 'Graph type',
			},
		});
		chip.createSpan({ cls: 'mathgraph-type-chip-label', text: GRAPH_TYPE_LABELS[this.spec.type] });
		chip.createSpan({ cls: 'mathgraph-type-chip-caret', text: '▾' });
		chip.addEventListener('click', evt => {
			evt.preventDefault();
			const menu = new Menu();
			for (const [value, label] of Object.entries(GRAPH_TYPE_LABELS) as Array<[GraphType, string]>) {
				menu.addItem(item => {
					item.setTitle(label);
					item.setChecked(value === this.spec.type);
					item.onClick(() => this.changeGraphType(value));
				});
			}
			menu.showAtMouseEvent(evt);
		});
	}

	/** Switch graph type while preserving everything the user already entered that still applies. */
	private changeGraphType(next: GraphType): void {
		if (next === this.spec.type) {
			return;
		}

		const previous = this.spec;
		const fresh = defaultGraphSpec(next, this.plugin.settings);

		if (previous.size) {
			fresh.size = previous.size;
		}
		if (previous.title?.trim()) {
			fresh.title = previous.title;
		}

		const fn = getUserFunction(previous);
		if (fn && next !== 'data' && next !== 'parametric2d' && next !== 'parametric3d') {
			setUserFunction(fresh, fn);
		}
		if (next === 'parametric2d' || next === 'parametric3d') {
			fresh.parameter = previous.parameter ?? 't';
			fresh.xExpression = previous.xExpression ?? '';
			fresh.yExpression = previous.yExpression ?? '';
			fresh.zExpression = previous.zExpression ?? '';
		}
		if (previous.parameters && Object.keys(previous.parameters).length > 0) {
			fresh.parameters = { ...previous.parameters };
		}
		if (previous.points?.length) {
			fresh.points = previous.points;
		}
		if (previous.samples) {
			fresh.samples = previous.samples;
		}

		const freshRanges = fresh.ranges ?? {};
		for (const key of Object.keys(freshRanges) as Array<'x' | 'y' | 'z' | 't'>) {
			const prevRange = previous.ranges?.[key];
			if (prevRange && (prevRange[0].trim() || prevRange[1].trim())) {
				freshRanges[key] = prevRange;
			}
		}

		this.spec = fresh;
		this.renderForm();
	}

	private formTextArea(
		parent: HTMLElement,
		label: string,
		value: string,
		onChange: (value: string) => void,
		options?: { placeholder?: string; withTypeChip?: boolean },
	): void {
		const row = parent.createDiv({ cls: 'mathgraph-form-row mathgraph-form-row-wide' });
		if (options?.withTypeChip) {
			const labelRow = row.createDiv({ cls: 'mathgraph-label-row' });
			labelRow.createEl('label', { cls: 'mathgraph-field-label', text: label });
			this.renderTypeChip(labelRow);
		} else {
			row.createEl('label', { cls: 'mathgraph-field-label', text: label });
		}
		const field = row.createDiv({ cls: 'mathgraph-field' });
		const input = field.createEl('textarea', {
			cls: 'mathgraph-input mathgraph-textarea',
			text: value,
		});
		if (options?.placeholder) {
			input.placeholder = options.placeholder;
		}
		input.rows = 4;
		input.addEventListener('input', () => onChange(input.value));
	}

	private formSelect(
		parent: HTMLElement,
		label: string,
		value: string,
		choices: Array<{ value: string; label: string }>,
		onChange: (value: string) => void,
		options?: { help?: string; wide?: boolean },
	): void {
		const field = this.formRow(parent, label, options);
		const select = field.createEl('select', { cls: 'mathgraph-select' });
		for (const choice of choices) {
			select.createEl('option', { text: choice.label, value: choice.value });
		}
		select.value = value;
		select.addEventListener('change', () => onChange(select.value));
	}

	private rangeInline(
		parent: HTMLElement,
		label: string,
		current: [string, string],
		onChange: (min: string, max: string) => void,
	): void {
		const group = parent.createDiv({ cls: 'mathgraph-range-inline' });
		group.createSpan({ cls: 'mathgraph-range-inline-label', text: label });
		const minInput = group.createEl('input', {
			type: 'text',
			cls: 'mathgraph-input mathgraph-range-inline-input',
			value: current[0],
			attr: { placeholder: 'min' },
		});
		group.createSpan({ cls: 'mathgraph-range-inline-sep', text: '–' });
		const maxInput = group.createEl('input', {
			type: 'text',
			cls: 'mathgraph-input mathgraph-range-inline-input',
			value: current[1],
			attr: { placeholder: 'max' },
		});
		const sync = () => onChange(minInput.value, maxInput.value);
		minInput.addEventListener('input', sync);
		maxInput.addEventListener('input', sync);
	}

	/** Compact [−][value][+] control; apply() clamps and returns the value to display. */
	private numberStepper(
		parent: HTMLElement,
		label: string,
		initial: number,
		step: number,
		apply: (next: number) => number,
	): void {
		const group = parent.createDiv({ cls: 'mathgraph-range-inline' });
		group.createSpan({ cls: 'mathgraph-range-inline-label', text: label });
		const stepper = group.createDiv({ cls: 'mathgraph-stepper' });

		const format = (value: number) => String(Number.parseFloat(value.toFixed(2)));
		const minusBtn = stepper.createEl('button', {
			type: 'button',
			cls: 'mathgraph-stepper-btn',
			text: '−',
			attr: { 'aria-label': `Decrease ${label.toLowerCase()}` },
		});
		const input = stepper.createEl('input', {
			type: 'text',
			cls: 'mathgraph-input mathgraph-stepper-value',
			value: format(initial),
		});
		const plusBtn = stepper.createEl('button', {
			type: 'button',
			cls: 'mathgraph-stepper-btn',
			text: '+',
			attr: { 'aria-label': `Increase ${label.toLowerCase()}` },
		});

		const current = () => Number.parseFloat(input.value.trim());
		const set = (next: number) => {
			input.value = format(apply(next));
		};

		minusBtn.addEventListener('click', () => set((Number.isFinite(current()) ? current() : initial) - step));
		plusBtn.addEventListener('click', () => set((Number.isFinite(current()) ? current() : initial) + step));
		input.addEventListener('change', () => {
			const parsed = current();
			set(Number.isFinite(parsed) ? parsed : initial);
		});
	}

	private sampleInline(
		parent: HTMLElement,
		label: string,
		value: string,
		onChange: (value: string) => void,
	): void {
		const group = parent.createDiv({ cls: 'mathgraph-range-inline mathgraph-sample-inline' });
		group.createSpan({ cls: 'mathgraph-range-inline-label', text: label });
		const input = group.createEl('input', {
			type: 'text',
			cls: 'mathgraph-input mathgraph-range-inline-input',
			value,
		});
		input.addEventListener('input', () => onChange(input.value));
	}

	private renderEquationSection(panel: HTMLElement): void {
		const grid = this.formGrid(panel);

		switch (this.spec.type) {
			case 'function2d':
				this.formPrimaryText(grid, 'Function', getUserFunction(this.spec), value => {
					setUserFunction(this.spec, value);
				}, placeholderForGraphType('function2d'));
				break;
			case 'surface3d':
				this.formPrimaryText(grid, 'Surface function', getUserFunction(this.spec), value => {
					setUserFunction(this.spec, value);
				}, placeholderForGraphType('surface3d'));
				break;
			case 'parametric2d':
			case 'parametric3d':
				this.formPrimaryText(grid, 'x(t)', this.spec.xExpression ?? '', value => {
					this.spec.xExpression = value;
				});
				this.formText(grid, 'y(t)', this.spec.yExpression ?? '', value => {
					this.spec.yExpression = value;
				}, { wide: true });
				if (this.spec.type === 'parametric3d') {
					this.formText(grid, 'z(t)', this.spec.zExpression ?? '', value => {
						this.spec.zExpression = value;
					}, { wide: true });
				}
				this.formText(grid, 'Parameter', this.spec.parameter ?? 't', value => {
					this.spec.parameter = value || 't';
				}, { placeholder: 't' });
				break;
			case 'ode':
			case 'pde':
				this.formPrimaryText(grid, 'Solution', getUserFunction(this.spec), value => {
					setUserFunction(this.spec, value);
				}, placeholderForGraphType(this.spec.type));
				this.formText(grid, 'Equation label', this.spec.equation ?? '', value => {
					this.spec.equation = value;
				}, { wide: true });
				if (this.spec.type === 'pde') {
					this.formSelect(grid, 'View', this.spec.view ?? '3d', [
						{ value: '2d', label: '2D curve / slice' },
						{ value: '3d', label: '3D surface' },
					], value => {
						this.spec.view = value as '2d' | '3d';
						this.renderForm();
					});
				}
				panel.createEl('p', {
					cls: 'mathgraph-equation-tab-note',
					text: 'ODE/PDE modes plot explicit solutions.',
				});
				break;
			case 'data':
				this.formTextArea(grid, 'Data points', (this.spec.data ?? [])
					.map(row => `${row.x}, ${row.y}`).join('\n'), raw => {
					this.spec.data = raw.split('\n')
						.map(line => line.trim())
						.filter(Boolean)
						.map(line => {
							const [x, y] = line.split(',').map(part => part.trim());
							return { x: x ?? '0', y: y ?? '0' };
						});
				}, { withTypeChip: true });
				break;
		}

		this.formText(grid, 'Title', this.spec.title ?? '', value => {
			this.spec.title = value;
		}, {
			placeholder: 'Optional graph title',
			wide: true,
		});

		if (this.spec.type !== 'data') {
			this.renderParametersBlock(grid);
		}
	}

	private renderParametersBlock(parent: HTMLElement): void {
		const block = parent.createDiv({ cls: 'mathgraph-form-row-wide mathgraph-param-block' });
		block.createEl('label', { cls: 'mathgraph-field-label', text: 'Parameters' });
		const list = block.createDiv({ cls: 'mathgraph-param-list' });

		const params = this.spec.parameters ?? {};
		for (const [name, value] of Object.entries(params)) {
			this.addParameterRow(list, name, value);
		}

		block.createEl('button', {
			type: 'button',
			cls: 'mathgraph-button mathgraph-button-secondary mathgraph-inline-add-btn',
			text: 'Add parameter',
		}).addEventListener('click', () => this.addParameterRow(list, '', ''));
	}

	private addParameterRow(parent: HTMLElement, name: string, value: string): void {
		const row = parent.createDiv({ cls: 'mathgraph-inline-row' });
		const nameInput = row.createEl('input', {
			type: 'text',
			cls: 'mathgraph-input',
			value: name,
			attr: { placeholder: 'name' },
		});
		const valueInput = row.createEl('input', {
			type: 'text',
			cls: 'mathgraph-input',
			value,
			attr: { placeholder: 'value' },
		});
		const removeBtn = row.createEl('button', {
			type: 'button',
			cls: 'mathgraph-button mathgraph-button-secondary mathgraph-row-remove',
			text: '×',
			attr: { 'aria-label': 'Remove parameter' },
		});
		const sync = () => {
			this.syncParametersFromDom(parent);
		};
		nameInput.addEventListener('input', sync);
		valueInput.addEventListener('input', sync);
		removeBtn.addEventListener('click', () => {
			row.remove();
			sync();
		});
	}

	private syncParametersFromDom(list: HTMLElement): void {
		const rows = list.querySelectorAll('.mathgraph-inline-row');
		const params: Record<string, string> = {};
		rows.forEach(row => {
			const inputs = row.querySelectorAll('input');
			const paramName = inputs[0]?.value.trim();
			const paramValue = inputs[1]?.value.trim() ?? '';
			if (paramName) {
				params[paramName] = paramValue;
			}
		});
		this.spec.parameters = params;
	}

	private renderRangesSection(panel: HTMLElement): void {
		const line = panel.createDiv({ cls: 'mathgraph-ranges-line' });
		const ranges = this.spec.ranges ?? {};
		const type = this.spec.type;
		const is3dView = this.spec.view === '3d';
		const showZRange = type === 'surface3d'
			|| type === 'parametric3d'
			|| (type === 'pde' && is3dView);
		const showSamplesY = showZRange;

		const addRange = (key: 'x' | 'y' | 'z' | 't', label: string) => {
			const current = ranges[key] ?? ['', ''];
			this.rangeInline(line, label, current, (min, max) => {
				this.spec.ranges = this.spec.ranges ?? {};
				this.spec.ranges[key] = [min, max];
			});
		};

		if (type === 'parametric2d' || type === 'parametric3d') {
			addRange('t', 't');
			addRange('x', 'x');
			addRange('y', 'y');
			if (type === 'parametric3d') {
				addRange('z', 'z');
			}
		} else {
			addRange('x', 'x');
			addRange('y', 'y');
			if (showZRange) {
				addRange('z', 'z');
			}
		}

		this.sampleInline(line, 'Samples', String(this.spec.samples ?? 100), value => {
			const parsed = Number.parseInt(value, 10);
			this.spec.samples = Number.isFinite(parsed) ? parsed : 100;
		});

		if (showSamplesY) {
			this.sampleInline(line, 'Samples Y', String(this.spec.samplesY ?? 35), value => {
				const parsed = Number.parseInt(value, 10);
				this.spec.samplesY = Number.isFinite(parsed) ? parsed : 35;
			});
		}
	}

	private renderStyleSection(panel: HTMLElement): void {
		const grid = this.formGrid(panel);
		const style = this.spec.style ?? {};
		hydrateGraphStyle(this.spec);

		if (graphSupportsGridToggle(this.spec)) {
			this.formSelect(grid, 'Grid', gridEnabledForGraph(this.spec) ? 'on' : 'off', [
				{ value: 'on', label: 'On' },
				{ value: 'off', label: 'Off' },
			], value => {
				this.spec.style = this.spec.style ?? {};
				this.spec.style.grid = value === 'on';
			});
		}

		if (graphSupportsSurfaceStyleControl(this.spec)) {
			this.formSelect(grid, 'Surface style', style.surfaceStyle ?? 'colored', [
				{ value: 'colored', label: 'Colored' },
				{ value: 'wireframe', label: 'Wireframe' },
				{ value: 'solid', label: 'Solid' },
			], value => {
				this.spec.style = this.spec.style ?? {};
				this.spec.style.surfaceStyle = value as SurfaceStyle;
			});
		} else {
			this.formText(grid, 'Color', style.color ?? '', value => {
				this.spec.style = this.spec.style ?? {};
				this.spec.style.color = value;
			}, { placeholder: 'auto' });
		}

		this.formText(grid, 'Line width', style.width ?? '', value => {
			this.spec.style = this.spec.style ?? {};
			this.spec.style.width = value;
		}, { placeholder: '1pt' });

		const appearanceLine = panel.createDiv({ cls: 'mathgraph-ranges-line mathgraph-axis-labels-line' });
		this.numberStepper(appearanceLine, 'Axis width', resolveAxisLineWidth(this.spec), 0.2, next => {
			this.spec.style = this.spec.style ?? {};
			this.spec.style.axisWidth = clampAxisLineWidth(next);
			return this.spec.style.axisWidth;
		});
		this.numberStepper(appearanceLine, 'Text size', resolveLabelFontSize(this.spec), 1, next => {
			this.spec.style = this.spec.style ?? {};
			this.spec.style.labelFontSize = clampLabelFontSize(next);
			return this.spec.style.labelFontSize;
		});

		const labels = this.spec.labels ?? {};
		const labelsLine = panel.createDiv({ cls: 'mathgraph-ranges-line mathgraph-axis-labels-line' });
		labelsLine.createSpan({ cls: 'mathgraph-range-inline-label mathgraph-line-caption', text: 'Axis labels' });
		for (const axis of ['x', 'y', 'z'] as const) {
			if (axis === 'z' && !graphUses3dPoints(this.spec)) {
				continue;
			}
			const group = labelsLine.createDiv({ cls: 'mathgraph-range-inline' });
			group.createSpan({ cls: 'mathgraph-range-inline-label', text: axis });
			const input = group.createEl('input', {
				type: 'text',
				cls: 'mathgraph-input mathgraph-range-inline-input',
				value: labels[axis] ?? axis,
			});
			input.addEventListener('input', () => {
				this.spec.labels = this.spec.labels ?? {};
				this.spec.labels[axis] = input.value;
			});
		}
	}

	private renderSizeSection(panel: HTMLElement): void {
		const grid = this.formGrid(panel);
		grid.addClass('mathgraph-size-section');
		const size = ensureGraphSize(this.spec);

		this.formSelect(grid, 'LaTeX size preset', size.preset, Object.entries(GRAPH_SIZE_PRESET_LABELS)
			.map(([value, label]) => ({ value, label })), value => {
			this.spec.size = applyPresetToGraphSize(
				value as GraphSizePreset,
				this.spec.size,
				this.spec,
			);
			this.renderForm();
		});

		if (graphUses2dAspectRatio(this.spec)) {
			this.formSelect(
				grid,
				'Aspect',
				size.aspectMode ?? 'auto',
				Object.entries(ASPECT_MODE_LABELS).map(([value, label]) => ({ value, label })),
				value => {
					this.spec.size = {
						...ensureGraphSize(this.spec),
						aspectMode: value as AspectMode,
					};
				},
			);
		}

		if (size.preset === 'custom') {
			this.formText(grid, 'Width', size.width ?? '', value => {
				this.spec.size = {
					...ensureGraphSize(this.spec),
					preset: 'custom',
					width: value.trim(),
				};
			}, { placeholder: '15cm' });

			this.formText(grid, 'Height', size.height ?? '', value => {
				this.spec.size = {
					...ensureGraphSize(this.spec),
					preset: 'custom',
					height: value.trim(),
				};
			}, { placeholder: '10cm' });
		}

		const scaleRow = grid.createDiv({ cls: 'mathgraph-form-row' });
		scaleRow.createEl('label', { cls: 'mathgraph-field-label', text: 'Display scale' });
		const scaleField = scaleRow.createDiv({ cls: 'mathgraph-field' });
		const stepper = scaleField.createDiv({ cls: 'mathgraph-stepper' });

		const minusBtn = stepper.createEl('button', {
			type: 'button',
			cls: 'mathgraph-stepper-btn',
			text: '−',
			attr: { 'aria-label': 'Decrease display scale' },
		});
		const valueInput = stepper.createEl('input', {
			type: 'text',
			cls: 'mathgraph-input mathgraph-stepper-value',
			value: formatDisplayScaleLabel(size.displayScale ?? 1),
		});
		const plusBtn = stepper.createEl('button', {
			type: 'button',
			cls: 'mathgraph-stepper-btn',
			text: '+',
			attr: { 'aria-label': 'Increase display scale' },
		});

		const setScale = (next: number) => {
			const clamped = clampDisplayScale(next);
			valueInput.value = formatDisplayScaleLabel(clamped);
			this.spec.size = {
				...ensureGraphSize(this.spec),
				displayScale: clamped,
			};
		};

		minusBtn.addEventListener('click', () => {
			setScale(clampDisplayScale(ensureGraphSize(this.spec).displayScale ?? 1) - DISPLAY_SCALE_STEP);
		});
		plusBtn.addEventListener('click', () => {
			setScale(clampDisplayScale(ensureGraphSize(this.spec).displayScale ?? 1) + DISPLAY_SCALE_STEP);
		});
		valueInput.addEventListener('change', () => {
			const pct = Number.parseFloat(valueInput.value.replace('%', '').trim());
			if (Number.isFinite(pct) && pct > 0) {
				setScale(pct / 100);
			} else {
				valueInput.value = formatDisplayScaleLabel(ensureGraphSize(this.spec).displayScale ?? 1);
			}
		});
	}

	private renderPointsSection(panel: HTMLElement): void {
		const is3d = graphUses3dPoints(this.spec);
		const autoY = graphSupportsAutoComputeY(this.spec);
		const autoZ = graphSupportsAutoComputeZ(this.spec);
		const list = panel.createDiv({ cls: 'mathgraph-point-list' });
		const points = this.spec.points ?? [];
		const emptyPoint: GraphPoint = is3d
			? { x: '', y: '', z: '', label: '' }
			: { x: '', y: autoY ? '' : '', label: '' };

		for (const point of points) {
			this.addPointRow(list, point, is3d, autoY, autoZ);
		}

		panel.createEl('button', {
			type: 'button',
			cls: 'mathgraph-button mathgraph-button-secondary mathgraph-inline-add-btn',
			text: 'Add point',
		}).addEventListener('click', () => this.addPointRow(list, { ...emptyPoint }, is3d, autoY, autoZ));

		this.pointWarningsEl = panel.createDiv({ cls: 'mathgraph-point-warnings' });
		this.refreshPointWarnings(list, is3d);
	}

	private addPointRow(
		parent: HTMLElement,
		point: GraphPoint,
		is3d: boolean,
		autoY: boolean,
		autoZ: boolean,
	): void {
		const wrap = parent.createDiv({ cls: 'mathgraph-point-row-wrap' });
		const row = wrap.createDiv({ cls: 'mathgraph-inline-row mathgraph-point-row' });
		const sync = () => {
			this.syncPointsFromDom(parent, is3d);
			this.refreshPointWarnings(parent, is3d);
		};

		row.createEl('input', {
			type: 'text',
			cls: 'mathgraph-input',
			value: point.x,
			attr: { placeholder: 'x' },
		}).addEventListener('input', sync);

		row.createEl('input', {
			type: 'text',
			cls: 'mathgraph-input',
			value: point.y ?? '',
			attr: { placeholder: autoY ? 'y (optional)' : 'y' },
		}).addEventListener('input', sync);

		if (is3d) {
			row.createEl('input', {
				type: 'text',
				cls: 'mathgraph-input',
				value: point.z ?? '',
				attr: { placeholder: autoZ ? 'z (optional)' : 'z' },
			}).addEventListener('input', sync);
		}

		row.createEl('input', {
			type: 'text',
			cls: 'mathgraph-input',
			value: point.label ?? '',
			attr: { placeholder: 'label' },
		}).addEventListener('input', sync);

		row.createEl('button', {
			type: 'button',
			cls: 'mathgraph-button mathgraph-button-secondary mathgraph-row-remove',
			text: '×',
			attr: { 'aria-label': 'Remove point' },
		}).addEventListener('click', () => {
			wrap.remove();
			sync();
		});

		const status = wrap.createDiv({ cls: 'mathgraph-point-status' });
		this.updatePointRowStatus(status, point);
	}

	private updatePointRowStatus(statusEl: HTMLElement, point: GraphPoint): void {
		statusEl.empty();
		statusEl.removeClass(
			'mathgraph-point-status-computed',
			'mathgraph-point-status-warning',
			'mathgraph-point-status-error',
		);

		const analysis = analyzeGraphPoint(this.spec, point);
		if (!analysis?.statusText) {
			return;
		}

		statusEl.setText(analysis.statusText);
		if (analysis.status === 'computed-y' || analysis.status === 'computed-z') {
			statusEl.addClass('mathgraph-point-status-computed');
		} else if (analysis.status === 'not-on-graph') {
			statusEl.addClass('mathgraph-point-status-warning');
		} else if (analysis.status === 'could-not-evaluate') {
			statusEl.addClass('mathgraph-point-status-error');
		}
	}

	private refreshPointWarnings(list: HTMLElement, is3d: boolean): void {
		this.syncPointsFromDom(list, is3d);

		list.querySelectorAll('.mathgraph-point-row-wrap').forEach((wrap, index) => {
			const statusEl = wrap.querySelector('.mathgraph-point-status');
			const point = this.spec.points?.[index];
			if (isHTMLElement(statusEl) && point) {
				this.updatePointRowStatus(statusEl, point);
			}
		});

		if (!this.pointWarningsEl) {
			return;
		}

		this.pointWarningsEl.empty();
		const warning = summarizeGraphPointWarnings(this.spec);
		if (warning) {
			this.pointWarningsEl.createDiv({
				cls: 'mathgraph-point-warning-banner',
				text: warning,
			});
		}
	}

	private syncPointsFromDom(list: HTMLElement, is3d = graphUses3dPoints(this.spec)): void {
		const rows = list.querySelectorAll('.mathgraph-point-row');
		const points: GraphPoint[] = [];
		const autoY = graphSupportsAutoComputeY(this.spec);
		const autoZ = graphSupportsAutoComputeZ(this.spec);

		rows.forEach((row, rowIndex) => {
			const inputs = row.querySelectorAll('input[type="text"]');
			const x = (inputs[0] as HTMLInputElement | undefined)?.value.trim() ?? '';
			const y = (inputs[1] as HTMLInputElement | undefined)?.value.trim() ?? '';
			const z = is3d ? (inputs[2] as HTMLInputElement | undefined)?.value.trim() ?? '' : undefined;
			const labelIndex = is3d ? 3 : 2;
			const label = (inputs[labelIndex] as HTMLInputElement | undefined)?.value.trim();
			// showValue has no form control — carry it over from the stored point (JSON-editable).
			const showValue = this.spec.points?.[rowIndex]?.showValue;

			if (!x) {
				return;
			}
			if (!autoY && !y) {
				return;
			}
			if (!autoZ && is3d && !z) {
				return;
			}
			if (autoZ && is3d && !y) {
				return;
			}

			const entry: GraphPoint = {
				x,
				label: label || undefined,
				showValue: showValue || undefined,
			};
			if (autoY) {
				entry.y = y;
			} else if (y) {
				entry.y = y;
			}
			if (is3d) {
				entry.z = autoZ ? z : (z || undefined);
			}
			points.push(entry);
		});

		this.spec.points = attachComputedCoordinates(this.spec, points);
	}

	private async submit(): Promise<void> {
		const paramList = this.sections.get('equation')?.querySelector('.mathgraph-param-list');
		if (isHTMLElement(paramList)) {
			this.syncParametersFromDom(paramList);
		}
		const pointList = this.sections.get('points')?.querySelector('.mathgraph-point-list');
		if (isHTMLElement(pointList)) {
			this.syncPointsFromDom(pointList);
		}

		const sizeError = validateGraphSize(ensureGraphSize(this.spec));
		if (sizeError) {
			new Notice(sizeError);
			this.sections.get('size')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
			return;
		}

		try {
			if (this.options.mode === 'edit' && this.options.location) {
				await replaceGraphBlockBody(this.app, this.options.location, this.spec);
				new Notice('Graph updated.');
			} else if (this.options.onInsert) {
				await this.options.onInsert(this.spec);
				new Notice('Graph inserted.');
			} else {
				await this.plugin.insertGraph(this.spec);
				new Notice('Graph inserted.');
			}

			const clipWarning = surfaceZRangeClipWarning(this.spec);
			if (clipWarning) {
				new Notice(clipWarning);
			}

			this.close();
		} catch (err) {
			new Notice(err instanceof Error ? err.message : 'Could not save graph.');
		}
	}

	onClose(): void {
		this.modalEl.removeClass('mathgraph-modal-container');
		this.contentEl.empty();
	}
}
