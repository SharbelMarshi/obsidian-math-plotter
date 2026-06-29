import { MarkdownView, Notice, Plugin } from 'obsidian';
import { GraphRenderer } from './render/renderer';
import { resolvePluginBaseDir } from './src/pluginPaths';
import { clearGraphRenderCache } from './src/graphRenderCache';
import { ensureTikzJaxFontsLoaded } from './src/tikzJaxFonts';
import { insertGraphBlockAtCursor } from './src/GraphBlockUpdater';
import { GraphBuilderModal } from './src/graphBuilderModal';
import { registerGraphProcessor } from './src/graphProcessor';
import type { GraphSpec } from './src/graphSpec';
import {
	DEFAULT_SETTINGS,
	MathGraphSettingTab,
	type MathGraphSettings,
} from './src/settings';
import { applyMathGraphUiStyle } from './src/uiStyle';
import { getCurrentTheme, type ThemeName } from './src/graphThemeColors';
import {
	createThemeWatcher,
	refreshVisibleGraphsForThemeChange,
	rerenderGraphContainer,
	type GraphRerenderOptions,
} from './src/graphThemeWatcher';
import { mergeLoadedSettings } from './src/settingsGuards';
// TODO(v2): register inlineGraphEditorExtension() for source-mode empty ```graph``` widgets.

export default class MathGraphStudioPlugin extends Plugin {
	settings: MathGraphSettings = DEFAULT_SETTINGS;
	renderer!: GraphRenderer;
	currentTheme: ThemeName = 'light';

	private themeWatcher: { disconnect: () => void } | null = null;
	private themeChangeCallbacks = new Set<(theme: ThemeName) => void>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.applyUiStyle();

		const pluginBaseDir = resolvePluginBaseDir(this);
		if (!GraphRenderer.tikzJaxAssetsPresent(pluginBaseDir)) {
			console.warn(
				'[Math Plotter] TikZJax assets missing. Run `npm install && npm run build` in the plugin folder.',
				pluginBaseDir,
			);
		}

		this.renderer = new GraphRenderer(
			() => this.app.workspace.containerEl.ownerDocument.body.classList.contains('theme-dark'),
			() => ({
				lualatexPath: this.settings.lualatexPath,
				useLocalLuaLatexFallback: this.settings.useLocalLuaLatexFallback,
			}),
			pluginBaseDir,
			() => ensureTikzJaxFontsLoaded(this.app, this),
		);

		this.currentTheme = getCurrentTheme();
		this.initThemeWatcher();

		this.addCommand({
			id: 'insert-math-graph',
			name: 'Insert Function Plot',
			callback: () => this.openInsertModal(),
		});

		this.addRibbonIcon('line-chart', 'Insert Function Plot', () => {
			this.openInsertModal();
		});

		this.addSettingTab(new MathGraphSettingTab(this.app, this));
		registerGraphProcessor(this);
	}

	onunload(): void {
		this.themeWatcher?.disconnect();
		this.renderer.clearCache();
	}

	getCurrentTheme(): ThemeName {
		return getCurrentTheme();
	}

	onThemeChanged(callback: (theme: ThemeName) => void): () => void {
		this.themeChangeCallbacks.add(callback);
		return () => {
			this.themeChangeCallbacks.delete(callback);
		};
	}

	notifyThemeChanged(theme: ThemeName): void {
		for (const callback of this.themeChangeCallbacks) {
			callback(theme);
		}
	}

	refreshVisibleGraphsForThemeChange(): void {
		refreshVisibleGraphsForThemeChange(this.app);
	}

	rerenderGraphContainer(container: HTMLElement, options?: GraphRerenderOptions): void {
		rerenderGraphContainer(container, options);
	}

	initThemeWatcher(): void {
		this.themeWatcher?.disconnect();
		this.currentTheme = getCurrentTheme();
		this.themeWatcher = createThemeWatcher(this);
		this.register(() => this.themeWatcher?.disconnect());
	}

	async loadSettings(): Promise<void> {
		const saved = await this.loadData();
		this.settings = mergeLoadedSettings(saved);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.applyUiStyle();
		this.renderer.clearCache();
		clearGraphRenderCache();
	}

	applyUiStyle(): void {
		applyMathGraphUiStyle(this.app.workspace.containerEl.ownerDocument);
	}

	openInsertModal(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			new Notice('Open a note to insert a graph.');
			return;
		}

		new GraphBuilderModal(this.app, this, {
			mode: 'insert',
			onInsert: spec => this.insertGraph(spec),
		}).open();
	}

	async insertGraph(spec: GraphSpec): Promise<void> {
		await insertGraphBlockAtCursor(this.app, spec);
	}
}
