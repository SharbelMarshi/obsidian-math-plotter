import { App, Modal, Notice, Setting } from 'obsidian';
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
	type GraphRenderEngine,
	type GraphType,
} from './graphSpec';
import {
	applyPresetToGraphSize,
	clampDisplayScale,
	DISPLAY_SCALE_MAX,
	DISPLAY_SCALE_MIN,
	DISPLAY_SCALE_STEP,
	ensureGraphSize,
	formatDisplayScaleLabel,
	GRAPH_SIZE_PRESET_LABELS,
	resolveGraphDimensions,
	validateGraphSize,
	type GraphSizePreset,
} from './graphSize';
import { surfaceZRangeClipWarning } from './graphRangeValidation';
import { uiStyleClassName } from './uiStyle';

export interface GraphBuilderModalOptions {
	mode: 'insert' | 'edit';
	spec?: GraphSpec;
	location?: GraphBlockLocation;
	onInsert?: (spec: GraphSpec) => Promise<void>;
}

export class GraphBuilderModal extends Modal {
	private spec: GraphSpec;
	private readonly options: GraphBuilderModalOptions;
	private bodyEl!: HTMLElement;
	private equationSection!: HTMLElement;
	private rangesSection!: HTMLElement;
	private parametersSection!: HTMLElement;
	private pointsSection!: HTMLElement;
	private sizeSection!: HTMLElement;
	private styleSection!: HTMLElement;
	private previewSection!: HTMLElement;
	private customSizeFields!: HTMLElement;

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
		contentEl.addClass('mathgraph-modal', uiStyleClassName(this.plugin.settings.uiStyle));
		titleEl.hide();

		const header = contentEl.createDiv({ cls: 'mathgraph-modal-header' });
		header.createDiv({
			cls: 'mathgraph-modal-title',
			text: 'MathGraph Studio',
		});
		header.createDiv({
			cls: 'mathgraph-modal-subtitle',
			text: 'Create a function, surface, ODE/PDE solution, or data graph.',
		});

		this.bodyEl = contentEl.createDiv({ cls: 'mathgraph-modal-body' });
		this.renderTopRow();
		this.renderSections();

		const footer = contentEl.createDiv({ cls: 'mathgraph-modal-footer mathgraph-modal-actions' });
		footer.createEl('button', { text: 'Cancel', cls: 'mathgraph-button mathgraph-button-secondary' })
			.addEventListener('click', () => this.close());

		const primaryLabel = this.options.mode === 'edit' ? 'Save Graph' : 'Insert Graph';
		footer.createEl('button', { text: primaryLabel, cls: 'mathgraph-button mathgraph-button-primary' })
			.addEventListener('click', () => void this.submit());
	}

	private createSection(title: string, description?: string): HTMLElement {
		const section = this.bodyEl.createDiv({ cls: 'mathgraph-section' });
		const header = section.createDiv({ cls: 'mathgraph-section-header' });
		header.createDiv({ cls: 'mathgraph-section-title', text: title });
		if (description) {
			header.createDiv({ cls: 'mathgraph-section-description', text: description });
		}
		return section.createDiv({ cls: 'mathgraph-section-body' });
	}

	private renderTopRow(): void {
		const row = this.bodyEl.createDiv({ cls: 'mathgraph-modal-top-row' });

		const typeField = row.createDiv({ cls: 'mathgraph-field' });
		typeField.createEl('label', { text: 'Graph type', cls: 'mathgraph-label' });
		const typeSelect = typeField.createEl('select', { cls: 'mathgraph-select' });
		for (const [value, label] of Object.entries(GRAPH_TYPE_LABELS)) {
			typeSelect.createEl('option', { text: label, value });
		}
		typeSelect.value = this.spec.type;
		typeSelect.addEventListener('change', () => {
			const preservedSize = this.spec.size;
			this.spec = defaultGraphSpec(typeSelect.value as GraphType, this.plugin.settings);
			if (preservedSize) {
				this.spec.size = preservedSize;
			}
			this.renderForm();
		});

		const renderField = row.createDiv({ cls: 'mathgraph-field' });
		renderField.createEl('label', { text: 'Render mode', cls: 'mathgraph-label' });
		const renderSelect = renderField.createEl('select', { cls: 'mathgraph-select' });
		renderSelect.createEl('option', { text: 'Auto', value: 'auto' });
		renderSelect.createEl('option', { text: 'Symbolic (PGFPlots)', value: 'symbolic' });
		if (this.plugin.settings.enableOctaveEngine) {
			renderSelect.createEl('option', { text: 'Octave (numeric)', value: 'octave' });
		}
		renderSelect.value = this.spec.renderEngine ?? 'auto';
		renderSelect.addEventListener('change', () => {
			this.spec.renderEngine = renderSelect.value as GraphRenderEngine;
			this.updatePreview();
		});
	}

	private renderSections(): void {
		this.bodyEl.querySelectorAll('.mathgraph-section').forEach(el => el.remove());

		this.equationSection = this.createSection(
			'Function / Equation',
			'Enter math in simple syntax. Examples: sin^2(x), x^2+y^2, exp(-2*t)*sin(x)*sin(y).',
		);
		this.rangesSection = this.createSection(
			'Ranges',
			'Domain limits and sample counts for the plot.',
		);
		this.parametersSection = this.createSection(
			'Parameters',
			'Substitute named values into the solution before rendering.',
		);
		this.pointsSection = this.createSection(
			'Labeled Points',
			'Optional overlay points drawn on top of the graph.',
		);
		this.sizeSection = this.createSection(
			'Size',
			'Graph size (LaTeX) sets PGFPlots axis dimensions and affects render quality and export. Display scale only changes how the image appears in Obsidian.',
		);
		this.styleSection = this.createSection(
			'Style',
			'Colors, line width, and axis labels.',
		);

		const previewWrap = this.bodyEl.createDiv({ cls: 'mathgraph-section' });
		const previewHeader = previewWrap.createDiv({ cls: 'mathgraph-section-header' });
		previewHeader.createDiv({ cls: 'mathgraph-section-title', text: 'Preview' });
		previewHeader.createDiv({
			cls: 'mathgraph-section-description',
			text: 'Summary of the graph configuration before inserting.',
		});
		this.previewSection = previewWrap.createDiv({ cls: 'mathgraph-preview-card' });

		this.renderForm();
	}

	private renderForm(): void {
		this.equationSection.empty();
		this.rangesSection.empty();
		this.parametersSection.empty();
		this.pointsSection.empty();
		this.sizeSection.empty();
		this.styleSection.empty();
		this.previewSection.empty();

		this.renderTypeFields();
		this.renderRanges();
		this.renderParameters();
		this.renderDataEditor();
		this.renderSize();
		this.renderStyle();
		this.renderLabels();
		this.updatePreview();
		this.updateSectionVisibility();
	}

	private updateSectionVisibility(): void {
		const type = this.spec.type;
		const showParameters = type === 'ode' || type === 'pde';
		const showPoints = type !== 'data';
		this.parametersSection.parentElement?.toggleVisibility(showParameters);
		this.pointsSection.parentElement?.toggleVisibility(showPoints);
	}

	private renderTypeFields(): void {
		new Setting(this.equationSection)
			.setName('Title')
			.addText(text => {
				text.setPlaceholder('Optional graph title')
					.setValue(this.spec.title ?? '')
					.onChange(value => {
						this.spec.title = value;
						this.updatePreview();
					});
			});

		switch (this.spec.type) {
			case 'function2d':
			case 'surface3d':
				new Setting(this.equationSection)
					.setName('Function')
					.addText(text => {
						text.inputEl.addClass('mathgraph-input');
						text.setPlaceholder(placeholderForGraphType(this.spec.type))
							.setValue(getUserFunction(this.spec))
							.onChange(value => {
								setUserFunction(this.spec, value);
								this.updatePreview();
							});
					});
				break;
			case 'parametric2d':
			case 'parametric3d':
				new Setting(this.equationSection)
					.setName('Parameter')
					.addText(text => {
						text.inputEl.addClass('mathgraph-input');
						text.setPlaceholder('t')
							.setValue(this.spec.parameter ?? 't')
							.onChange(value => { this.spec.parameter = value || 't'; });
					});
				new Setting(this.equationSection)
					.setName('x(t)')
					.addText(text => {
						text.inputEl.addClass('mathgraph-input');
						text.setValue(this.spec.xExpression ?? '')
							.onChange(value => {
								this.spec.xExpression = value;
								this.updatePreview();
							});
					});
				new Setting(this.equationSection)
					.setName('y(t)')
					.addText(text => {
						text.inputEl.addClass('mathgraph-input');
						text.setValue(this.spec.yExpression ?? '')
							.onChange(value => {
								this.spec.yExpression = value;
								this.updatePreview();
							});
					});
				if (this.spec.type === 'parametric3d') {
					new Setting(this.equationSection)
						.setName('z(t)')
						.addText(text => {
							text.inputEl.addClass('mathgraph-input');
							text.setValue(this.spec.zExpression ?? '')
								.onChange(value => {
									this.spec.zExpression = value;
									this.updatePreview();
								});
						});
				}
				break;
			case 'ode':
			case 'pde':
				new Setting(this.equationSection)
					.setName('Equation label')
					.setDesc('Displayed as the equation caption; not evaluated.')
					.addText(text => {
						text.inputEl.addClass('mathgraph-input');
						text.setPlaceholder('u_t = u_xx + u_yy')
							.setValue(this.spec.equation ?? '')
							.onChange(value => {
								this.spec.equation = value;
								this.updatePreview();
							});
					});
				new Setting(this.equationSection)
					.setName('Solution')
					.addText(text => {
						text.inputEl.addClass('mathgraph-input');
						text.setPlaceholder(placeholderForGraphType(this.spec.type))
							.setValue(getUserFunction(this.spec))
							.onChange(value => {
								setUserFunction(this.spec, value);
								this.updatePreview();
							});
					});
				new Setting(this.equationSection)
					.setName('View')
					.addDropdown(drop => {
						drop.selectEl.addClass('mathgraph-select');
						drop.addOption('2d', '2D curve / slice');
						drop.addOption('3d', '3D surface');
						drop.setValue(this.spec.view ?? (this.spec.type === 'pde' ? '3d' : '2d'));
						drop.onChange(value => {
							this.spec.view = value as '2d' | '3d';
							this.renderForm();
						});
					});
				break;
			case 'data':
				new Setting(this.equationSection)
					.setName('Data points')
					.setDesc('Enter x,y pairs below or paste comma-separated values.')
					.addTextArea(text => {
						text.inputEl.addClass('mathgraph-input');
						const rows = (this.spec.data ?? []).map(row => `${row.x}, ${row.y}`).join('\n');
						text.setValue(rows)
							.onChange(raw => {
								this.spec.data = raw.split('\n')
									.map(line => line.trim())
									.filter(Boolean)
									.map(line => {
										const [x, y] = line.split(',').map(part => part.trim());
										return { x: x ?? '0', y: y ?? '0' };
									});
								this.updatePreview();
							});
					});
				break;
		}
	}

	private renderRanges(): void {
		const ranges = this.spec.ranges ?? {};
		const addRange = (key: 'x' | 'y' | 'z' | 't', label: string) => {
			const current = ranges[key] ?? ['', ''];
			new Setting(this.rangesSection)
				.setName(`${label} range`)
				.addText(min => {
					min.inputEl.addClass('mathgraph-input');
					min.setPlaceholder('min')
						.setValue(current[0])
						.onChange(value => {
							this.spec.ranges = this.spec.ranges ?? {};
							this.spec.ranges[key] = [value, this.spec.ranges[key]?.[1] ?? ''];
							this.updatePreview();
						});
				})
				.addText(max => {
					max.inputEl.addClass('mathgraph-input');
					max.setPlaceholder('max')
						.setValue(current[1])
						.onChange(value => {
							this.spec.ranges = this.spec.ranges ?? {};
							const minVal = this.spec.ranges[key]?.[0] ?? '';
							this.spec.ranges[key] = [minVal, value];
							this.updatePreview();
						});
				});
		};

		const type = this.spec.type;
		const is3dView = this.spec.view === '3d';

		if (type === 'parametric2d' || type === 'parametric3d') {
			addRange('t', 't');
		}

		if (type !== 'parametric2d' && type !== 'parametric3d') {
			addRange('x', 'x');
		}

		if (type === 'function2d' || type === 'ode' || type === 'data') {
			addRange('y', 'y');
		}

		if (type === 'surface3d' || type === 'parametric3d' || (type === 'pde' && is3dView)) {
			addRange('y', 'y');
		}

		if (type === 'surface3d' || type === 'parametric3d' || is3dView) {
			addRange('z', 'z');
		}

		if (type === 'parametric2d' || type === 'parametric3d') {
			addRange('x', 'x');
			addRange('y', 'y');
		}

		new Setting(this.rangesSection)
			.setName('Samples')
			.addText(text => {
				text.inputEl.addClass('mathgraph-input');
				text.setValue(String(this.spec.samples ?? 100))
					.onChange(value => {
						const parsed = Number.parseInt(value, 10);
						this.spec.samples = Number.isFinite(parsed) ? parsed : 100;
					});
			});

		if (this.spec.view === '3d' || this.spec.type === 'surface3d' || this.spec.type === 'pde') {
			new Setting(this.rangesSection)
				.setName('Samples Y')
				.addText(text => {
					text.inputEl.addClass('mathgraph-input');
					text.setValue(String(this.spec.samplesY ?? 35))
						.onChange(value => {
							const parsed = Number.parseInt(value, 10);
							this.spec.samplesY = Number.isFinite(parsed) ? parsed : 35;
						});
				});
		}
	}

	private renderLabels(): void {
		const labels = this.spec.labels ?? {};
		for (const axis of ['x', 'y', 'z'] as const) {
			if (axis === 'z' && this.spec.type === 'function2d') {
				continue;
			}
			new Setting(this.styleSection)
				.setName(`${axis}-axis label`)
				.addText(text => {
					text.inputEl.addClass('mathgraph-input');
					text.setValue(labels[axis] ?? axis)
						.onChange(value => {
							this.spec.labels = this.spec.labels ?? {};
							this.spec.labels[axis] = value;
						});
				});
		}
	}

	private renderStyle(): void {
		const style = this.spec.style ?? {};
		new Setting(this.styleSection)
			.setName('Color')
			.addText(text => {
				text.inputEl.addClass('mathgraph-input');
				text.setPlaceholder('blue')
					.setValue(style.color ?? '')
					.onChange(value => {
						this.spec.style = this.spec.style ?? {};
						this.spec.style.color = value;
					});
			});

		new Setting(this.styleSection)
			.setName('Line width')
			.addText(text => {
				text.inputEl.addClass('mathgraph-input');
				text.setPlaceholder('1pt')
					.setValue(style.width ?? '')
					.onChange(value => {
						this.spec.style = this.spec.style ?? {};
						this.spec.style.width = value;
					});
			});
	}

	private renderSize(): void {
		const size = ensureGraphSize(this.spec, this.plugin.settings);
		const dims = resolveGraphDimensions(this.spec, this.plugin.settings);

		const latexHeader = this.sizeSection.createDiv({ cls: 'mathgraph-size-subsection-header' });
		latexHeader.createDiv({ cls: 'mathgraph-size-subsection-title', text: 'Graph size (LaTeX)' });
		latexHeader.createDiv({
			cls: 'mathgraph-size-subsection-desc',
			text: 'PGFPlots axis width and height. Affects labels, spacing, quality, and SVG/PNG export. Saving changes re-renders the graph.',
		});

		new Setting(this.sizeSection)
			.setName('Size preset')
			.setDesc(`Current axis: ${dims.width} × ${dims.height}`)
			.addDropdown(drop => {
				drop.selectEl.addClass('mathgraph-select');
				for (const [value, label] of Object.entries(GRAPH_SIZE_PRESET_LABELS)) {
					drop.addOption(value, label);
				}
				drop.setValue(size.preset);
				drop.onChange(value => {
					this.spec.size = applyPresetToGraphSize(
						value as GraphSizePreset,
						this.spec.size,
						this.plugin.settings,
						this.spec,
					);
					this.renderForm();
				});
			});

		this.customSizeFields = this.sizeSection.createDiv({ cls: 'mathgraph-field-grid' });
		this.customSizeFields.toggleVisibility(size.preset === 'custom');

		const widthField = this.customSizeFields.createDiv({ cls: 'mathgraph-field' });
		widthField.createEl('label', { text: 'Width', cls: 'mathgraph-label' });
		const widthInput = widthField.createEl('input', {
			type: 'text',
			cls: 'mathgraph-input',
			value: size.width ?? '',
		});
		widthInput.placeholder = '15cm';
		widthInput.addEventListener('change', () => {
			this.spec.size = {
				...ensureGraphSize(this.spec, this.plugin.settings),
				preset: 'custom',
				width: widthInput.value.trim(),
			};
			this.updatePreview();
		});

		const heightField = this.customSizeFields.createDiv({ cls: 'mathgraph-field' });
		heightField.createEl('label', { text: 'Height', cls: 'mathgraph-label' });
		const heightInput = heightField.createEl('input', {
			type: 'text',
			cls: 'mathgraph-input',
			value: size.height ?? '',
		});
		heightInput.placeholder = '9cm';
		heightInput.addEventListener('change', () => {
			this.spec.size = {
				...ensureGraphSize(this.spec, this.plugin.settings),
				preset: 'custom',
				height: heightInput.value.trim(),
			};
			this.updatePreview();
		});

		const displayHeader = this.sizeSection.createDiv({ cls: 'mathgraph-size-subsection-header' });
		displayHeader.createDiv({ cls: 'mathgraph-size-subsection-title', text: 'Display scale (Obsidian)' });
		displayHeader.createDiv({
			cls: 'mathgraph-size-subsection-desc',
			text: 'Visual zoom in Reading View only. Use hover − / + on the graph for quick adjustments without recompiling LaTeX.',
		});

		const scaleField = this.sizeSection.createDiv({ cls: 'mathgraph-field mathgraph-field-wide' });
		const scaleHeader = scaleField.createDiv({ cls: 'mathgraph-size-scale-header' });
		scaleHeader.createEl('label', { text: 'Display scale', cls: 'mathgraph-label' });
		const scaleValue = scaleHeader.createSpan({ cls: 'mathgraph-size-scale-value' });
		scaleValue.setText(String(clampDisplayScale(size.displayScale ?? 1)));

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
			scaleValue.setText(String(next));
			this.spec.size = {
				...ensureGraphSize(this.spec, this.plugin.settings),
				displayScale: next,
			};
			this.updatePreview();
		});
	}

	private renderParameters(): void {
		if (this.spec.type !== 'ode' && this.spec.type !== 'pde') {
			return;
		}

		const params = this.spec.parameters ?? {};
		const entries = Object.entries(params);

		if (entries.length === 0) {
			this.addParameterRow('t', '0');
		} else {
			for (const [name, value] of entries) {
				this.addParameterRow(name, value);
			}
		}

		new Setting(this.parametersSection)
			.addButton(btn => {
				btn.setButtonText('Add parameter');
				btn.buttonEl.addClass('mathgraph-button', 'mathgraph-button-secondary');
				btn.onClick(() => this.addParameterRow('', ''));
			});
	}

	private addParameterRow(name: string, value: string): void {
		const row = this.parametersSection.createDiv({ cls: 'mathgraph-param-row' });
		new Setting(row)
			.addText(text => {
				text.inputEl.addClass('mathgraph-input');
				text.setPlaceholder('name')
					.setValue(name)
					.onChange(() => this.syncParametersFromDom());
			})
			.addText(text => {
				text.inputEl.addClass('mathgraph-input');
				text.setPlaceholder('value')
					.setValue(value)
					.onChange(() => this.syncParametersFromDom());
			})
			.addExtraButton(btn => {
				btn.setIcon('trash')
					.setTooltip('Remove')
					.onClick(() => {
						row.remove();
						this.syncParametersFromDom();
						this.updatePreview();
					});
			});
	}

	private syncParametersFromDom(): void {
		const rows = this.parametersSection.querySelectorAll('.mathgraph-param-row');
		const params: Record<string, string> = {};
		rows.forEach(row => {
			const inputs = row.querySelectorAll('input');
			const paramName = inputs[0]?.value.trim();
			const value = inputs[1]?.value.trim() ?? '';
			if (paramName) {
				params[paramName] = value;
			}
		});
		this.spec.parameters = params;
	}

	private renderDataEditor(): void {
		if (this.spec.type === 'data') {
			return;
		}
		const points = this.spec.points ?? [];
		if (points.length === 0) {
			this.addPointRow({ x: '', y: '', label: '' });
		} else {
			for (const point of points) {
				this.addPointRow(point);
			}
		}
		new Setting(this.pointsSection)
			.addButton(btn => {
				btn.setButtonText('Add point');
				btn.buttonEl.addClass('mathgraph-button', 'mathgraph-button-secondary');
				btn.onClick(() => this.addPointRow({ x: '', y: '', label: '' }));
			});
	}

	private addPointRow(point: GraphPoint): void {
		const row = this.pointsSection.createDiv({ cls: 'mathgraph-point-row' });
		new Setting(row)
			.addText(text => {
				text.inputEl.addClass('mathgraph-input');
				text.setPlaceholder('x')
					.setValue(point.x)
					.onChange(() => this.syncPointsFromDom());
			})
			.addText(text => {
				text.inputEl.addClass('mathgraph-input');
				text.setPlaceholder('y')
					.setValue(point.y)
					.onChange(() => this.syncPointsFromDom());
			})
			.addText(text => {
				text.inputEl.addClass('mathgraph-input');
				text.setPlaceholder('label')
					.setValue(point.label ?? '')
					.onChange(() => this.syncPointsFromDom());
			})
			.addExtraButton(btn => {
				btn.setIcon('trash')
					.onClick(() => {
						row.remove();
						this.syncPointsFromDom();
					});
			});
	}

	private syncPointsFromDom(): void {
		const rows = this.pointsSection.querySelectorAll('.mathgraph-point-row');
		const points: GraphPoint[] = [];
		rows.forEach(row => {
			const inputs = row.querySelectorAll('input');
			const x = inputs[0]?.value.trim() ?? '';
			const y = inputs[1]?.value.trim() ?? '';
			const label = inputs[2]?.value.trim();
			if (x && y) {
				points.push({ x, y, label: label || undefined });
			}
		});
		this.spec.points = points;
	}

	private updatePreview(): void {
		this.previewSection.empty();

		const header = this.previewSection.createDiv({ cls: 'mathgraph-preview-card-header' });
		header.createDiv({
			cls: 'mathgraph-pill mathgraph-pill-accent',
			text: GRAPH_TYPE_LABELS[this.spec.type],
		});

		const renderEngine = this.spec.renderEngine ?? 'auto';
		header.createDiv({ cls: 'mathgraph-pill', text: `Render: ${renderEngine}` });

		const expression = this.previewExpressionText();
		if (expression) {
			this.previewSection.createDiv({
				cls: 'mathgraph-preview-expression',
				text: expression,
			});
		}

		const rangeSummary = this.previewRangeSummary();
		const dims = resolveGraphDimensions(this.spec, this.plugin.settings);
		const size = ensureGraphSize(this.spec, this.plugin.settings);
		this.previewSection.createDiv({
			cls: 'mathgraph-preview-meta',
			text: `LaTeX: ${dims.width} × ${dims.height} · Display: ${formatDisplayScaleLabel(size.displayScale ?? 1)}${rangeSummary ? ` · ${rangeSummary}` : ''}`,
		});

		const clipWarning = surfaceZRangeClipWarning(this.spec);
		if (clipWarning) {
			this.previewSection.createDiv({
				cls: 'mathgraph-preview-warning',
				text: clipWarning,
			});
		}
	}

	private previewExpressionText(): string {
		switch (this.spec.type) {
			case 'parametric2d':
			case 'parametric3d': {
				const parts = [
					this.spec.xExpression?.trim(),
					this.spec.yExpression?.trim(),
					this.spec.zExpression?.trim(),
				].filter(Boolean);
				return parts.length ? parts.join(' ; ') : '';
			}
			case 'data':
				return `${this.spec.data?.length ?? 0} data points`;
			default:
				return getUserFunction(this.spec);
		}
	}

	private previewRangeSummary(): string {
		const ranges = this.spec.ranges ?? {};
		const parts: string[] = [];
		for (const key of ['x', 'y', 'z', 't'] as const) {
			const range = ranges[key];
			if (range?.[0] && range?.[1]) {
				parts.push(`${key}: [${range[0]}, ${range[1]}]`);
			}
		}
		return parts.join(' · ');
	}

	private async submit(): Promise<void> {
		this.syncParametersFromDom();
		this.syncPointsFromDom();

		const sizeError = validateGraphSize(ensureGraphSize(this.spec, this.plugin.settings));
		if (sizeError) {
			new Notice(sizeError);
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
