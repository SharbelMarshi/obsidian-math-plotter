import type { App, Plugin } from 'obsidian';

const STYLE_ID = 'mathgraph-tikzjax-fonts';

/** Load bundled TikZJax @font-face rules once (for inline SVG / export; img data URLs still need svgTickLabelFix). */
export function ensureTikzJaxFontsLoaded(app: App, plugin: Plugin, doc: Document = activeDocument): void {
	if (doc.getElementById(STYLE_ID)) {
		return;
	}

	const manifestDir = plugin.manifest.dir?.trim();
	if (!manifestDir) {
		return;
	}

	const href = app.vault.adapter.getResourcePath(`${manifestDir}/assets/tikzjax/fonts.css`);
	const link = doc.createElement('link');
	link.id = STYLE_ID;
	link.rel = 'stylesheet';
	link.href = href;
	doc.head.appendChild(link);
}
