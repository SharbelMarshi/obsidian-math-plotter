import { App, Modal, Notice } from 'obsidian';
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
	DISPLAY_SCALE_MAX,
	DISPLAY_SCALE_MIN,
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
import { mathgraphUiClassName } from './uiStyle';

export interface GraphBuilderModalOptions {
	mode: 'insert' | 'edit';
	spec?: GraphSpec;
	location?: GraphBlockLocation;
	onInsert?: (spec: GraphSpec) => Promise<void>;
}

type BuilderTab = 'equation' | 'ranges' | 'style' | 'size' | 'points';

const BUILDER_TABS: Array<{ id: BuilderTab; label: string }> = [
	{ id: 'equation', label: 'Equation' },
	{ id: 'ranges', label: 'Ranges' },
	{ id: 'style', label: 'Style' },
	{ id: 'size', label: 'Size' },
	{ id: 'points', label: 'Points' },
];

export class GraphBuilderModal extends Modal {
	private spec: GraphSpec;
	private readonly options: GraphBuilderModalOptions;
	private shellEl!: HTMLElement;
	private panelEl!: HTMLElement;
	private activeTab: BuilderTab = 'equation';
	private navItems = new Map<BuilderTab, HTMLElement>();
	private panels = new Map<BuilderTab, HTMLElement>();
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
		this.renderMain();
		this.renderFooter();
		this.renderForm();
		this.switchTab(this.activeTab);
	}

	private renderHeader(): void {
		const header = this.shellEl.createDiv({ cls: 'mathgraph-modal-header' });
		const textWrap = header.createDiv({ cls: 'mathgraph-modal-header-text' });
		textWrap.createDiv({ cls: 'mathgraph-modal-title', text: 'Math Plotter' });
	}

	private renderMain(): void {
		const main = this.shellEl.createDiv({ cls: 'mathgraph-modal-main' });
		const nav = main.createDiv({ cls: 'mathgraph-modal-nav' });

		for (const tab of BUILDER_TABS) {
			const item = nav.createDiv({
				cls: 'mathgraph-modal-nav-item',
				text: tab.label,
			});
			item.dataset.tab = tab.id;
			item.addEventListener('click', () => this.switchTab(tab.id));
			this.navItems.set(tab.id, item);
		}

		this.panelEl = main.createDiv({ cls: 'mathgraph-modal-panel-scroll' });
		for (const tab of BUILDER_TABS) {
			const panel = this.panelEl.createDiv({ cls: 'mathgraph-modal-panel' });
			panel.dataset.tab = tab.id;
			this.panels.set(tab.id, panel);
		}
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

	private switchTab(tab: BuilderTab): void {
		this.activeTab = tab;
		for (const [id, item] of this.navItems) {
			item.toggleClass('mathgraph-modal-nav-item-active', id === tab);
		}
		for (const [id, panel] of this.panels) {
			panel.toggleClass('mathgraph-modal-panel-active', id === tab);
		}
	}

	private updateNavVisibility(): void {
		const pointsNav = this.navItems.get('points');
		pointsNav?.toggleClass('mathgraph-modal-nav-item-hidden', this.spec.type === 'data');
		if (this.spec.type === 'data' && this.activeTab === 'points') {
			this.switchTab('equation');
		}
	}

	private getPanel(tab: BuilderTab): HTMLElement {
		const panel = this.panels.get(tab);
		if (!panel) {
			throw new Error(`Missing builder panel: ${tab}`);
		}
		return panel;
	}

	private renderForm(): void {
		for (const panel of this.panels.values()) {
			panel.empty();
		}

		this.renderEquationPanel(this.getPanel('equation'));
		this.renderRangesPanel(this.getPanel('ranges'));
		this.renderStylePanel(this.getPanel('style'));
		this.renderSizePanel(this.getPanel('size'));
		this.renderPointsPanel(this.getPanel('points'));
		this.updateNavVisibility();
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

	private formTextArea(
		parent: HTMLElement,
		label: string,
		value: string,
		onChange: (value: string) => void,
		options?: { placeholder?: string; help?: string; wide?: boolean },
	): void {
		const field = this.formRow(parent, label, { ...options, wide: true });
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

	private formRangeRow(
		parent: HTMLElement,
		label: string,
		current: [string, string],
		onChange: (min: string, max: string) => void,
	): void {
		const row = parent.createDiv({ cls: 'mathgraph-range-row' });
		row.createEl('label', { cls: 'mathgraph-range-label', text: `${label} range` });
		const minInput = row.createEl('input', {
			type: 'text',
			cls: 'mathgraph-input',
			value: current[0],
			attr: { placeholder: 'min' },
		});
		row.createSpan({ cls: 'mathgraph-range-separator', text: 'to' });
		const maxInput = row.createEl('input', {
			type: 'text',
			cls: 'mathgraph-input',
			value: current[1],
			attr: { placeholder: 'max' },
		});
		const sync = () => onChange(minInput.value, maxInput.value);
		minInput.addEventListener('input', sync);
		maxInput.addEventListener('input', sync);
	}

	private formSampleField(
		parent: HTMLElement,
		label: string,
		value: string,
		onChange: (value: string) => void,
	): void {
		const field = parent.createDiv({ cls: 'mathgraph-field mathgraph-sample-field' });
		field.createEl('label', { cls: 'mathgraph-field-label', text: label });
		const input = field.createEl('input', {
			type: 'text',
			cls: 'mathgraph-input',
			value,
		});
		input.addEventListener('input', () => onChange(input.value));
	}

	private renderEquationPanel(panel: HTMLElement): void {
		const grid = this.formGrid(panel);

		this.formSelect(grid, 'Graph type', this.spec.type, Object.entries(GRAPH_TYPE_LABELS)
			.map(([value, label]) => ({ value, label })), value => {
			const preservedSize = this.spec.size;
			this.spec = defaultGraphSpec(value as GraphType, this.plugin.settings);
			if (preservedSize) {
				this.spec.size = preservedSize;
			}
			this.renderForm();
			this.updateNavVisibility();
		}, { wide: true });

		this.formText(grid, 'Title', this.spec.title ?? '', value => {
			this.spec.title = value;
		}, {
			placeholder: 'Optional graph title',
			wide: true,
		});

		switch (this.spec.type) {
			case 'function2d':
				this.formText(grid, 'Function', getUserFunction(this.spec), value => {
					setUserFunction(this.spec, value);
				}, {
					placeholder: placeholderForGraphType('function2d'),
					wide: true,
				});
				break;
			case 'surface3d':
				this.formText(grid, 'Surface function', getUserFunction(this.spec), value => {
					setUserFunction(this.spec, value);
				}, {
					placeholder: placeholderForGraphType('surface3d'),
					wide: true,
				});
				break;
			case 'parametric2d':
			case 'parametric3d':
				this.formText(grid, 'Parameter', this.spec.parameter ?? 't', value => {
					this.spec.parameter = value || 't';
				}, { placeholder: 't' });
				this.formText(grid, 'x(t)', this.spec.xExpression ?? '', value => {
					this.spec.xExpression = value;
				}, { wide: true });
				this.formText(grid, 'y(t)', this.spec.yExpression ?? '', value => {
					this.spec.yExpression = value;
				}, { wide: true });
				if (this.spec.type === 'parametric3d') {
					this.formText(grid, 'z(t)', this.spec.zExpression ?? '', value => {
						this.spec.zExpression = value;
					}, { wide: true });
				}
				break;
			case 'ode':
			case 'pde':
				this.formText(grid, 'Equation label', this.spec.equation ?? '', value => {
					this.spec.equation = value;
				}, {
					placeholder: this.spec.type === 'pde' ? 'u_t = u_xx + u_yy' : "y' = -2y",
					wide: true,
				});
				this.formText(grid, 'Solution', getUserFunction(this.spec), value => {
					setUserFunction(this.spec, value);
				}, {
					placeholder: placeholderForGraphType(this.spec.type),
					wide: true,
				});
				if (this.spec.type === 'pde') {
					this.formSelect(grid, 'View', this.spec.view ?? '3d', [
						{ value: '2d', label: '2D curve / slice' },
						{ value: '3d', label: '3D surface' },
					], value => {
						this.spec.view = value as '2d' | '3d';
						this.renderForm();
					});
				}
				this.renderParametersBlock(grid);
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
				}, {
					placeholder: '0, 0\n1, 1\n2, 4',
					wide: true,
				});
				break;
		}
	}

	private renderParametersBlock(parent: HTMLElement): void {
		const block = parent.createDiv({ cls: 'mathgraph-form-row-wide mathgraph-param-block' });
		block.createEl('label', { cls: 'mathgraph-field-label', text: 'Parameters' });
		const list = block.createDiv({ cls: 'mathgraph-param-list' });

		const params = this.spec.parameters ?? {};
		const entries = Object.entries(params);
		if (entries.length === 0) {
			this.addParameterRow(list, 't', '0');
		} else {
			for (const [name, value] of entries) {
				this.addParameterRow(list, name, value);
			}
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

	private renderRangesPanel(panel: HTMLElement): void {
		const container = panel.createDiv({ cls: 'mathgraph-ranges-panel' });
		const ranges = this.spec.ranges ?? {};
		const type = this.spec.type;
		const is3dView = this.spec.view === '3d';
		const showZRange = type === 'surface3d'
			|| type === 'parametric3d'
			|| (type === 'pde' && is3dView);
		const showSamplesY = showZRange;

		const addRange = (key: 'x' | 'y' | 'z' | 't', label: string) => {
			const current = ranges[key] ?? ['', ''];
			this.formRangeRow(container, label, current, (min, max) => {
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

		const samplesRow = container.createDiv({
			cls: `mathgraph-samples-row${showSamplesY ? '' : ' mathgraph-samples-row-2d'}`,
		});

		this.formSampleField(samplesRow, 'Samples', String(this.spec.samples ?? 100), value => {
			const parsed = Number.parseInt(value, 10);
			this.spec.samples = Number.isFinite(parsed) ? parsed : 100;
		});

		if (showSamplesY) {
			this.formSampleField(samplesRow, 'Samples Y', String(this.spec.samplesY ?? 35), value => {
				const parsed = Number.parseInt(value, 10);
				this.spec.samplesY = Number.isFinite(parsed) ? parsed : 35;
			});
		}
	}

	private renderStylePanel(panel: HTMLElement): void {
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

		const labels = this.spec.labels ?? {};
		for (const axis of ['x', 'y', 'z'] as const) {
			if (axis === 'z' && this.spec.type === 'function2d') {
				continue;
			}
			this.formText(grid, `${axis}-axis label`, labels[axis] ?? axis, value => {
				this.spec.labels = this.spec.labels ?? {};
				this.spec.labels[axis] = value;
			});
		}
	}

	private renderSizePanel(panel: HTMLElement): void {
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
			this.switchTab('size');
		}, {
			wide: true,
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
				{ wide: true },
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

		const scaleRow = grid.createDiv({ cls: 'mathgraph-form-row mathgraph-form-row-wide' });
		scaleRow.createEl('label', { cls: 'mathgraph-field-label', text: 'Display scale' });
		const scaleField = scaleRow.createDiv({ cls: 'mathgraph-field mathgraph-size-scale-field' });
		const scaleValue = scaleField.createSpan({
			cls: 'mathgraph-size-scale-value',
			text: formatDisplayScaleLabel(size.displayScale ?? 1),
		});
		const scaleInput = scaleField.createEl('input', {
			type: 'range',
			cls: 'mathgraph-size-slider',
		});
		scaleInput.min = String(DISPLAY_SCALE_MIN);
		scaleInput.max = String(DISPLAY_SCALE_MAX);
		scaleInput.step = String(DISPLAY_SCALE_STEP);
		scaleInput.value = String(clampDisplayScale(size.displayScale ?? 1));
		scaleInput.addEventListener('input', () => {
			const next = clampDisplayScale(Number.parseFloat(scaleInput.value));
			scaleValue.setText(formatDisplayScaleLabel(next));
			this.spec.size = {
				...ensureGraphSize(this.spec),
				displayScale: next,
			};
		});
	}

	private renderPointsPanel(panel: HTMLElement): void {
		if (this.spec.type === 'data') {
			panel.createEl('p', {
				cls: 'mathgraph-field-help',
				text: 'Data plots use the Equation tab for point values.',
			});
			return;
		}

		const is3d = graphUses3dPoints(this.spec);
		const autoY = graphSupportsAutoComputeY(this.spec);
		const autoZ = graphSupportsAutoComputeZ(this.spec);
		const list = panel.createDiv({ cls: 'mathgraph-point-list' });
		const points = this.spec.points ?? [];
		const emptyPoint: GraphPoint = is3d
			? { x: '', y: '', z: '', label: '' }
			: { x: '', y: autoY ? '' : '', label: '' };

		if (points.length === 0) {
			this.addPointRow(list, emptyPoint, is3d, autoY, autoZ);
		} else {
			for (const point of points) {
				this.addPointRow(list, point, is3d, autoY, autoZ);
			}
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

		rows.forEach(row => {
			const inputs = row.querySelectorAll('input');
			const x = inputs[0]?.value.trim() ?? '';
			const y = inputs[1]?.value.trim() ?? '';
			const z = is3d ? inputs[2]?.value.trim() ?? '' : undefined;
			const labelIndex = is3d ? 3 : 2;
			const label = inputs[labelIndex]?.value.trim();

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
		const paramList = this.panels.get('equation')?.querySelector('.mathgraph-param-list');
		if (isHTMLElement(paramList)) {
			this.syncParametersFromDom(paramList);
		}
		const pointList = this.panels.get('points')?.querySelector('.mathgraph-point-list');
		if (isHTMLElement(pointList)) {
			this.syncPointsFromDom(pointList);
		}

		const sizeError = validateGraphSize(ensureGraphSize(this.spec));
		if (sizeError) {
			new Notice(sizeError);
			this.switchTab('size');
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
