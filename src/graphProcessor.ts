import { Notice, type MarkdownPostProcessorContext } from 'obsidian';
import type MathGraphStudioPlugin from '../main';
import {
	classifyGraphBlockSource,
	replaceGraphBlockBody,
	resolveGraphBlockLocation,
	clearGraphBlockBody,
	type GraphBlockLocation,
} from './GraphBlockUpdater';
import { renderInlineGraphBuilder } from './InlineGraphBuilder';
import { buildGraphRenderBundle } from './graphJsonConverter';
import { formatOctaveRenderDebugDetails } from '../octave/octaveDataTikz';
import { OctaveEngineError } from '../octave/octaveRunner';
import { surfaceZRangeClipWarning } from './graphRangeValidation';
import { clampDisplayScale, ensureGraphSize } from './graphSize';
import { defaultGraphSpec, hydrateGraphSpec, type GraphSpec } from './graphSpec';
import { appendGraphError, renderGraphView } from './graphView';
import { GraphBuilderModal } from './graphBuilderModal';
import { decorateMathGraphRoot } from './uiStyle';

export function registerGraphProcessor(plugin: MathGraphStudioPlugin): void {
	plugin.registerMarkdownCodeBlockProcessor('graph', (source, el, ctx) => {
		el.empty();
		el.addClass('mathgraph-processor-root');
		decorateMathGraphRoot(el, plugin.settings);

		const classification = classifyGraphBlockSource(source, plugin.settings);

		if (classification.state === 'empty') {
			void renderEmptyBlock(plugin, el, ctx, source);
			return;
		}

		if (classification.state === 'invalid') {
			renderInvalidBlock(plugin, el, ctx, source, classification.error ?? 'Invalid graph block.');
			return;
		}

		renderValidBlock(plugin, el, ctx, source, classification.spec!);
	});
}

async function renderEmptyBlock(
	plugin: MathGraphStudioPlugin,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	source: string,
): Promise<void> {
	const location = await resolveGraphBlockLocation(plugin.app, ctx, source, el);
	if (!location) {
		appendGraphError(el, 'Could not locate empty graph block in note.');
		return;
	}

	renderInlineGraphBuilder(el, { plugin, ctx, location });
}

function renderValidBlock(
	plugin: MathGraphStudioPlugin,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	source: string,
	spec: GraphSpec,
): void {
	const loading = el.createDiv({ cls: 'mathgraph-loading', text: 'Rendering graph…' });
	let currentSpec = hydrateGraphSpec(structuredClone(spec), plugin.settings);

	const render = async () => {
		let bundle: Awaited<ReturnType<typeof buildGraphRenderBundle>> | undefined;
		try {
			bundle = await buildGraphRenderBundle(currentSpec, plugin.settings);
			const result = await plugin.renderer.renderToSvg(bundle.tikz, undefined, bundle.assets);

			loading.remove();

			const clipWarning = surfaceZRangeClipWarning(currentSpec);
			void setupGraphView(el, plugin, ctx, source, currentSpec, result, bundle.tikz, render, clipWarning);
		} catch (err) {
			loading.remove();
			const detailParts: string[] = [];
			if (err instanceof OctaveEngineError && err.rawLog) {
				detailParts.push(err.rawLog);
			}
			if (bundle?.octaveDebug) {
				detailParts.push(formatOctaveRenderDebugDetails(bundle.octaveDebug));
			}
			appendGraphError(el, err instanceof Error ? err.message : 'Could not render graph.', {
				details: detailParts.length > 0 ? detailParts.join('\n\n') : (err instanceof Error ? err.stack : undefined),
				onRetry: () => {
					el.empty();
					el.addClass('mathgraph-processor-root');
					decorateMathGraphRoot(el, plugin.settings);
					el.createDiv({ cls: 'mathgraph-loading', text: 'Rendering graph…' });
					void render();
				},
			});
		}
	};

	void render();
}

async function setupGraphView(
	el: HTMLElement,
	plugin: MathGraphStudioPlugin,
	ctx: MarkdownPostProcessorContext,
	source: string,
	spec: GraphSpec,
	result: Parameters<typeof renderGraphView>[2],
	tikz: string,
	rerender: () => Promise<void>,
	clipWarning?: string | null,
): Promise<void> {
	const location = await resolveGraphBlockLocation(plugin.app, ctx, source, el);

	renderGraphView(el, spec, result, tikz, {
		frame: plugin.settings.renderedGraphFrame,
		warnings: clipWarning ? [clipWarning] : undefined,
		onEdit: () => void openEditModal(plugin, spec, source, ctx, el),
		onEditSize: () => void openEditModal(plugin, spec, source, ctx, el),
		onRefresh: () => {
			el.empty();
			el.addClass('mathgraph-processor-root');
			decorateMathGraphRoot(el, plugin.settings);
			el.createDiv({ cls: 'mathgraph-loading', text: 'Rendering graph…' });
			void rerender();
		},
		onDisplayScaleChange: async newScale => {
			if (!location) {
				new Notice('Could not locate graph block to save size.');
				return;
			}
			// Display scale only — update JSON and CSS, no LaTeX recompile.
			const updated = hydrateGraphSpec(structuredClone(spec), plugin.settings);
			const size = ensureGraphSize(updated, plugin.settings);
			size.displayScale = clampDisplayScale(newScale);
			updated.size = size;
			spec.size = size;
			await replaceGraphBlockBody(plugin.app, location, updated);
		},
	});
}

function renderInvalidBlock(
	plugin: MathGraphStudioPlugin,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	source: string,
	message: string,
): void {
	const sourceEl = el.createEl('pre', { cls: 'mathgraph-invalid-source mathgraph-invalid-source-hidden' });
	sourceEl.setText(source.trim());

	appendGraphError(el, message, {
		details: source.trim(),
		actions: [
			{
				label: 'Edit Graph',
				onClick: () => void openInvalidEditModal(plugin, source, ctx, el),
				primary: true,
			},
			{
				label: 'Reset Block',
				onClick: () => void resetBlock(plugin, source, ctx, el),
			},
			{
				label: 'Show Source',
				onClick: () => {
					const hidden = sourceEl.hasClass('mathgraph-invalid-source-hidden');
					sourceEl.toggleClass('mathgraph-invalid-source-hidden', !hidden);
				},
			},
		],
	});
}

async function openEditModal(
	plugin: MathGraphStudioPlugin,
	spec: GraphSpec,
	source: string,
	ctx: MarkdownPostProcessorContext,
	el: HTMLElement,
): Promise<void> {
	const location = await resolveGraphBlockLocation(plugin.app, ctx, source, el);
	if (!location) {
		new Notice('Could not locate graph block in note.');
		return;
	}

	new GraphBuilderModal(plugin.app, plugin, {
		mode: 'edit',
		spec,
		location,
	}).open();
}

async function openInvalidEditModal(
	plugin: MathGraphStudioPlugin,
	source: string,
	ctx: MarkdownPostProcessorContext,
	el: HTMLElement,
): Promise<void> {
	const location = await resolveGraphBlockLocation(plugin.app, ctx, source, el);
	if (!location) {
		new Notice('Could not locate graph block in note.');
		return;
	}

	let seed = defaultGraphSpec('function2d', plugin.settings);
	try {
		const parsed = JSON.parse(source.trim()) as Partial<GraphSpec>;
		seed = hydrateGraphSpec({
			...defaultGraphSpec(parsed.type ?? 'function2d', plugin.settings),
			...parsed,
			version: 1,
		}, plugin.settings);
	} catch {
		// use default seed
	}

	new GraphBuilderModal(plugin.app, plugin, {
		mode: 'edit',
		spec: seed,
		location,
	}).open();
}

async function resetBlock(
	plugin: MathGraphStudioPlugin,
	source: string,
	ctx: MarkdownPostProcessorContext,
	el: HTMLElement,
): Promise<void> {
	const location = await resolveGraphBlockLocation(plugin.app, ctx, source, el);
	if (!location) {
		new Notice('Could not locate graph block in note.');
		return;
	}

	try {
		await clearGraphBlockBody(plugin.app, location);
		new Notice('Graph block reset.');
	} catch (err) {
		new Notice(err instanceof Error ? err.message : 'Could not reset block.');
	}
}
