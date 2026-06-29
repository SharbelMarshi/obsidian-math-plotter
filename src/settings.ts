import { App, PluginSettingTab, Setting } from 'obsidian';
import type MathGraphStudioPlugin from '../main';
import { UI_STYLE_LABELS, RENDERED_GRAPH_FRAME_LABELS, uiStyleClassName, type MathGraphUiStyle, type RenderedGraphFrame } from './uiStyle';
import { GRAPH_SIZE_PRESET_LABELS, type GraphSizePreset } from './graphSize';

export interface MathGraphSettings {
	uiStyle: MathGraphUiStyle;
	/** Frame around rendered graph output in notes. */
	renderedGraphFrame: RenderedGraphFrame;
	defaultSizePreset: GraphSizePreset;
	default2dWidth: string;
	default2dHeight: string;
	default3dWidth: string;
	default3dHeight: string;
	defaultDisplayScale: number;
	/** When false, all graphs use symbolic LuaLaTeX + PGFPlots only. */
	enableOctaveEngine: boolean;
	/** Empty string = auto-detect Octave on PATH. */
	octavePath: string;
	/** Use Octave numerical sampling for 3D surfaces and large grids. */
	preferOctaveFor3dSurfaces: boolean;
	/** Use Octave for ODE/PDE numeric sampling mode. */
	preferOctaveForOdePdeNumeric: boolean;
}

export const DEFAULT_SETTINGS: MathGraphSettings = {
	uiStyle: 'glass',
	renderedGraphFrame: 'none',
	defaultSizePreset: 'large',
	default2dWidth: '15cm',
	default2dHeight: '9cm',
	default3dWidth: '15cm',
	default3dHeight: '10cm',
	defaultDisplayScale: 1,
	enableOctaveEngine: false,
	octavePath: '',
	preferOctaveFor3dSurfaces: false,
	preferOctaveForOdePdeNumeric: false,
};

export class MathGraphSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: MathGraphStudioPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('mathgraph-settings-tab', uiStyleClassName(this.plugin.settings.uiStyle));

		this.renderSection(
			containerEl,
			'Appearance',
			'Choose how MathGraph Studio panels and cards look inside Obsidian.',
			section => {
				new Setting(section)
					.setName('UI style')
					.setDesc('Glass uses frosted panels with subtle blur. Native Obsidian uses flat theme cards.')
					.addDropdown(drop => {
						for (const [value, label] of Object.entries(UI_STYLE_LABELS)) {
							drop.addOption(value, label);
						}
						drop.setValue(this.plugin.settings.uiStyle);
						drop.onChange(async value => {
							this.plugin.settings.uiStyle = value as MathGraphUiStyle;
							await this.plugin.saveSettings();
							this.plugin.applyUiStyle();
							this.display();
						});
					});

				new Setting(section)
					.setName('Rendered graph frame')
					.setDesc('Border and background around graphs embedded in notes. None keeps output transparent and borderless.')
					.addDropdown(drop => {
						for (const [value, label] of Object.entries(RENDERED_GRAPH_FRAME_LABELS)) {
							drop.addOption(value, label);
						}
						drop.setValue(this.plugin.settings.renderedGraphFrame);
						drop.onChange(async value => {
							this.plugin.settings.renderedGraphFrame = value as RenderedGraphFrame;
							await this.plugin.saveSettings();
						});
					});
			},
		);

		this.renderSection(
			containerEl,
			'Default graph size (LaTeX)',
			'Default PGFPlots axis dimensions for new graphs. Affects render quality and export.',
			section => {
				new Setting(section)
					.setName('Default size preset')
					.addDropdown(drop => {
						for (const [value, label] of Object.entries(GRAPH_SIZE_PRESET_LABELS)) {
							if (value === 'custom') {
								continue;
							}
							drop.addOption(value, label);
						}
						drop.setValue(this.plugin.settings.defaultSizePreset);
						drop.onChange(async value => {
							this.plugin.settings.defaultSizePreset = value as GraphSizePreset;
							await this.plugin.saveSettings();
						});
					});

				new Setting(section)
					.setName('Default 2D width')
					.addText(text => text
						.setPlaceholder('15cm')
						.setValue(this.plugin.settings.default2dWidth)
						.onChange(async value => {
							this.plugin.settings.default2dWidth = value.trim();
							await this.plugin.saveSettings();
						}));

				new Setting(section)
					.setName('Default 2D height')
					.addText(text => text
						.setPlaceholder('9cm')
						.setValue(this.plugin.settings.default2dHeight)
						.onChange(async value => {
							this.plugin.settings.default2dHeight = value.trim();
							await this.plugin.saveSettings();
						}));

				new Setting(section)
					.setName('Default 3D width')
					.addText(text => text
						.setPlaceholder('15cm')
						.setValue(this.plugin.settings.default3dWidth)
						.onChange(async value => {
							this.plugin.settings.default3dWidth = value.trim();
							await this.plugin.saveSettings();
						}));

				new Setting(section)
					.setName('Default 3D height')
					.addText(text => text
						.setPlaceholder('10cm')
						.setValue(this.plugin.settings.default3dHeight)
						.onChange(async value => {
							this.plugin.settings.default3dHeight = value.trim();
							await this.plugin.saveSettings();
						}));

				new Setting(section)
					.setName('Default display scale')
					.setDesc('Visual zoom in Reading View (0.5–2.5). Does not change LaTeX output; adjustable per graph without recompiling.')
					.addSlider(slider => slider
						.setLimits(0.5, 2.5, 0.1)
						.setValue(this.plugin.settings.defaultDisplayScale)
						.setDynamicTooltip()
						.onChange(async value => {
							this.plugin.settings.defaultDisplayScale = value;
							await this.plugin.saveSettings();
						}));
			},
		);

		this.renderSection(
			containerEl,
			'Function syntax',
			'Type simple math in graph fields. The plugin converts expressions internally for rendering.',
			section => {
				section.createEl('p', {
					cls: 'mathgraph-settings-note',
					text: 'Examples: sin^2(x), x^2+y^2, exp(-2*t)*sin(x)*sin(y). log(x) is treated as the natural logarithm (same as ln(x)).',
				});
			},
		);

		this.renderSection(
			containerEl,
			'Rendering',
			'Basic graphs always work with LuaLaTeX + PGFPlots. Octave is optional for numerical sampling.',
			section => {
				new Setting(section)
					.setName('Enable Octave engine')
					.setDesc('Allow numerical sampling via Octave CLI. Octave is not required for basic graphs.')
					.addToggle(toggle => toggle
						.setValue(this.plugin.settings.enableOctaveEngine)
						.onChange(async value => {
							this.plugin.settings.enableOctaveEngine = value;
							await this.plugin.saveSettings();
							this.display();
						}));

				if (!this.plugin.settings.enableOctaveEngine) {
					return;
				}

				new Setting(section)
					.setName('Octave path')
					.setDesc('Leave empty to auto-detect (octave-cli or octave on PATH).')
					.addText(text => text
						.setPlaceholder('/opt/homebrew/bin/octave-cli')
						.setValue(this.plugin.settings.octavePath)
						.onChange(async value => {
							this.plugin.settings.octavePath = value.trim();
							await this.plugin.saveSettings();
						}));

				new Setting(section)
					.setName('Prefer Octave for 3D surfaces')
					.setDesc('Sample 3D surfaces and large grids with Octave, then render via PGFPlots table data.')
					.addToggle(toggle => toggle
						.setValue(this.plugin.settings.preferOctaveFor3dSurfaces)
						.onChange(async value => {
							this.plugin.settings.preferOctaveFor3dSurfaces = value;
							await this.plugin.saveSettings();
						}));

				new Setting(section)
					.setName('Prefer Octave for ODE/PDE numeric mode')
					.setDesc('Use Octave when a graph is marked numericMode or needs numerical ODE/PDE sampling.')
					.addToggle(toggle => toggle
						.setValue(this.plugin.settings.preferOctaveForOdePdeNumeric)
						.onChange(async value => {
							this.plugin.settings.preferOctaveForOdePdeNumeric = value;
							await this.plugin.saveSettings();
						}));
			},
		);
	}

	private renderSection(
		parent: HTMLElement,
		title: string,
		description: string,
		renderContent: (sectionBody: HTMLElement) => void,
	): void {
		const card = parent.createDiv({ cls: 'mathgraph-settings-section' });
		card.createDiv({ cls: 'mathgraph-settings-section-title', text: title });
		card.createDiv({ cls: 'mathgraph-settings-section-desc', text: description });
		const body = card.createDiv({ cls: 'mathgraph-section-body' });
		renderContent(body);
	}
}
