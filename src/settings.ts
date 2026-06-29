import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type MathGraphStudioPlugin from '../main';
import { DEFAULT_OCTAVE_CLI_PATH, detectOctaveCli } from '../octave/octaveResolver';
import { testOctaveCli } from '../octave/octaveRunner';
import { mathgraphUiClassName } from './uiStyle';

export type RenderOutputFormat = 'svg' | 'png';

export interface MathGraphSettings {
	enableOctaveEngine: boolean;
	octavePath: string;
	preferOctaveFor3dSurfaces: boolean;
	preferOctaveForOdePdeNumeric: boolean;
	/** Advanced: retry failed renders with local LuaLaTeX when available. */
	useLocalLuaLatexFallback: boolean;
	/** Empty = auto-detect LuaLaTeX. Used only when fallback is enabled. */
	lualatexPath: string;
	renderOutputFormat: RenderOutputFormat;
	debugMode: boolean;
}

export const DEFAULT_SETTINGS: MathGraphSettings = {
	enableOctaveEngine: false,
	octavePath: '',
	preferOctaveFor3dSurfaces: false,
	preferOctaveForOdePdeNumeric: false,
	useLocalLuaLatexFallback: false,
	lualatexPath: '',
	renderOutputFormat: 'svg',
	debugMode: false,
};

export class MathGraphSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: MathGraphStudioPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('mathgraph-settings-tab', mathgraphUiClassName());

		this.renderSection(containerEl, 'Output', section => {
			new Setting(section)
				.setName('Output format')
				.setDesc('Reading View uses SVG; PNG is used for export when selected.')
				.addDropdown(drop => {
					drop.addOption('svg', 'SVG');
					drop.addOption('png', 'PNG');
					drop.setValue(this.plugin.settings.renderOutputFormat);
					drop.onChange(async value => {
						this.plugin.settings.renderOutputFormat = value as RenderOutputFormat;
						await this.plugin.saveSettings();
					});
				});
		});

		this.renderSection(containerEl, 'Advanced', section => {
			new Setting(section)
				.setName('Use local LuaLaTeX fallback')
				.setDesc('When enabled, retry failed TikZJax renders with local LuaLaTeX if installed.')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.useLocalLuaLatexFallback)
					.onChange(async value => {
						this.plugin.settings.useLocalLuaLatexFallback = value;
						await this.plugin.saveSettings();
						this.display();
					}));

			if (this.plugin.settings.useLocalLuaLatexFallback) {
				new Setting(section)
					.setName('LuaLaTeX path')
					.setDesc('Leave empty to auto-detect.')
					.addText(text => text
						.setPlaceholder('/Library/TeX/texbin/lualatex')
						.setValue(this.plugin.settings.lualatexPath)
						.onChange(async value => {
							this.plugin.settings.lualatexPath = value.trim();
							await this.plugin.saveSettings();
						}));
			}

			new Setting(section)
				.setName('Enable Octave engine')
				.setDesc('Optional external numerical sampler. Off by default.')
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
				.setName('Octave CLI path')
				.setDesc('Use octave-cli if available.')
				.addText(text => {
					text
						.setPlaceholder(DEFAULT_OCTAVE_CLI_PATH)
						.setValue(this.plugin.settings.octavePath)
						.onChange(async value => {
							this.plugin.settings.octavePath = value.trim();
							await this.plugin.saveSettings();
						});
				})
				.addButton(btn => {
					btn.setButtonText('Detect Octave CLI');
					btn.onClick(async () => {
						const detected = await detectOctaveCli();
						if (detected) {
							this.plugin.settings.octavePath = detected;
							await this.plugin.saveSettings();
							new Notice(`Detected: ${detected}`);
							this.display();
						} else {
							new Notice('Octave CLI not found.');
						}
					});
				});

			new Setting(section)
				.setName('Test Octave')
				.setDesc('Check the configured Octave CLI.')
				.addButton(btn => {
					btn.setButtonText('Test Octave');
					btn.onClick(async () => {
						btn.setDisabled(true);
						try {
							const result = await testOctaveCli(this.plugin.settings.octavePath);
							if (result.ok) {
								new Notice('Octave CLI works.');
							} else {
								new Notice('Octave CLI failed. Check the Octave CLI path.');
								console.warn('[Math Plotter] Octave test failed', result);
							}
						} finally {
							btn.setDisabled(false);
						}
					});
				});

			new Setting(section)
				.setName('Prefer Octave for 3D surfaces')
				.setDesc('Use Octave instead of the built-in sampler when enabled.')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.preferOctaveFor3dSurfaces)
					.onChange(async value => {
						this.plugin.settings.preferOctaveFor3dSurfaces = value;
						await this.plugin.saveSettings();
					}));

			new Setting(section)
				.setName('Prefer Octave for ODE/PDE numeric mode')
				.setDesc('Use Octave when numericMode is set on a graph.')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.preferOctaveForOdePdeNumeric)
					.onChange(async value => {
						this.plugin.settings.preferOctaveForOdePdeNumeric = value;
						await this.plugin.saveSettings();
					}));
		});

		this.renderSection(containerEl, 'Debug', section => {
			new Setting(section)
				.setName('Debug mode')
				.setDesc('Include generated TikZ in error details.')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.debugMode)
					.onChange(async value => {
						this.plugin.settings.debugMode = value;
						await this.plugin.saveSettings();
					}));
		});
	}

	private renderSection(
		parent: HTMLElement,
		title: string,
		renderContent: (sectionBody: HTMLElement) => void,
	): void {
		const card = parent.createDiv({ cls: 'mathgraph-settings-section' });
		card.createDiv({ cls: 'mathgraph-settings-section-title', text: title });
		const body = card.createDiv({ cls: 'mathgraph-section-body mathgraph-settings-section-body' });
		renderContent(body);
	}
}
