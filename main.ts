import { MarkdownView, Notice, Plugin } from 'obsidian';
import { TikzRenderer } from './render/renderer';
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
// TODO(v2): register inlineGraphEditorExtension() for source-mode empty ```graph``` widgets.

export default class MathGraphStudioPlugin extends Plugin {
	settings: MathGraphSettings = DEFAULT_SETTINGS;
	renderer!: TikzRenderer;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.applyUiStyle();

		this.renderer = new TikzRenderer(
			() => activeDocument.body.classList.contains('theme-dark'),
		);

		this.addCommand({
			id: 'insert-math-graph',
			name: 'Insert Math Graph',
			callback: () => this.openInsertModal(),
		});

		this.addRibbonIcon('line-chart', 'Insert Math Graph', () => {
			this.openInsertModal();
		});

		this.addSettingTab(new MathGraphSettingTab(this.app, this));
		registerGraphProcessor(this);
	}

	onunload(): void {
		this.renderer.clearCache();
	}

	async loadSettings(): Promise<void> {
		const saved = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.applyUiStyle();
		this.renderer.clearCache();
	}

	applyUiStyle(): void {
		applyMathGraphUiStyle(activeDocument, this.settings);
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
