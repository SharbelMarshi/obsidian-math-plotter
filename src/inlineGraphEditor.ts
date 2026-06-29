/**
 * TODO: Live Preview source-mode widget for empty ```graph fences.
 *
 * Obsidian's registerMarkdownCodeBlockProcessor already renders the inline builder
 * in Live Preview (embedded preview). This module is reserved for a future
 * CodeMirror 6 decoration/widget that replaces empty graph fences while editing
 * in source mode with Live Preview disabled.
 *
 * Planned approach:
 * - StateField scanning for ```graph\n``` empty fence ranges
 * - WidgetType embedding a compact InlineGraphBuilder DOM node
 * - Block updates via GraphBlockUpdater.replaceGraphBlockBody
 */
export function inlineGraphEditorExtension(): unknown {
	// TODO(v2): implement CodeMirror 6 widget decoration for source-mode empty blocks.
	return [];
}
