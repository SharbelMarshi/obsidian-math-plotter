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
import { shouldUseOctave } from '../octave/octaveRouter';
import { shouldUseJsSampling } from '../sampler/samplingRouter';
import { OctaveEngineError } from '../octave/octaveRunner';
import type { RenderMode } from '../render/renderMode';
import { surfaceZRangeClipWarning } from './graphRangeValidation';
import { clampDisplayScale, ensureGraphSize } from './graphSize';
import { defaultGraphSpec, hydrateGraphSpec, type GraphSpec } from './graphSpec';
import {
	getCachedGraphRender,
	setCachedGraphRender,
	specRenderFingerprint,
	renderCacheKey,
	applyDisplayScaleToRoot,
} from './graphRenderCache';
import { appendGraphError, applyRenderedGraphDisplayScale, renderGraphView } from './graphView';
import { GraphBuilderModal } from './graphBuilderModal';
import { captureScrollPosition, restoreScrollPosition } from './scrollPreserve';
import { decorateMathGraphRoot } from './uiStyle';
import { isObsidianDarkTheme } from './graphThemeColors';
import { registerGraphRerenderHandler } from './graphThemeWatcher';
import { isHTMLElement } from './domUtils';

const DISPLAY_SCALE_SAVE_DELAY_MS = 500;
const RENDER_DEBOUNCE_MS = 500;
const displayScaleSaveTimers = new Map<string, number>();

function blockLocationKey(location: GraphBlockLocation): string {
	return `${location.sourcePath}:${location.startLine}`;
}

function scheduleDisplayScaleSave(
	plugin: MathGraphStudioPlugin,
	location: GraphBlockLocation,
	spec: GraphSpec,
): void {
	const key = blockLocationKey(location);
	const existing = displayScaleSaveTimers.get(key);
	if (existing !== undefined) {
		window.clearTimeout(existing);
	}

	displayScaleSaveTimers.set(key, window.setTimeout(() => {
		displayScaleSaveTimers.delete(key);
		const snapshot = captureScrollPosition(plugin.app);
		const updated = hydrateGraphSpec(structuredClone(spec), plugin.settings);
		void replaceGraphBlockBody(plugin.app, location, updated).finally(() => {
			restoreScrollPosition(plugin.app, snapshot);
		});
	}, DISPLAY_SCALE_SAVE_DELAY_MS));
}

export function registerGraphProcessor(plugin: MathGraphStudioPlugin): void {
	plugin.registerMarkdownCodeBlockProcessor('graph', (source, el, ctx) => {
		const classification = classifyGraphBlockSource(source, plugin.settings);

		if (classification.state === 'valid' && classification.spec) {
			const hydrated = hydrateGraphSpec(structuredClone(classification.spec), plugin.settings);
			const fingerprint = specRenderFingerprint(hydrated);
			const prevFingerprint = el.dataset.mathgraphFingerprint;
			const themeKey = isObsidianDarkTheme() ? 'dark' : 'light';
			const prevTheme = el.dataset.mathgraphTheme;
			const hasRenderedGraph = el.querySelector('.mathgraph-rendered-container') !== null;

			if (hasRenderedGraph && prevFingerprint === fingerprint && prevTheme === themeKey) {
				el.dataset.mathgraphFingerprint = fingerprint;
				el.dataset.mathgraphTheme = themeKey;
				applyDisplayScaleToRoot(el, hydrated);
				return;
			}
		}

		el.empty();
		el.addClass('mathgraph-processor-root');

		if (classification.state === 'empty') {
			void renderEmptyBlock(plugin, el, ctx, source);
			return;
		}

		decorateMathGraphRoot(el);

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
	hideAdjacentSourceEmbed(el);
}

function hideAdjacentSourceEmbed(el: HTMLElement): void {
	const prev = el.previousElementSibling;
	if (prev?.classList.contains('cm-embed-block')) {
		prev.addClass('mathgraph-hidden-embed');
	}
}

function renderValidBlock(
	plugin: MathGraphStudioPlugin,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	source: string,
	spec: GraphSpec,
): void {
	el.addClass('mathgraph-has-rendered-graph');
	hideAdjacentSourceEmbed(el);

	const ensureLoading = (text = 'Drawing graph…'): HTMLElement => {
		const existing = el.querySelector('.mathgraph-loading');
		if (isHTMLElement(existing)) {
			existing.setText(text);
			return existing;
		}
		return el.createDiv({ cls: 'mathgraph-loading', text });
	};

	ensureLoading();
	const currentSpec = hydrateGraphSpec(structuredClone(spec), plugin.settings);
	const fingerprint = specRenderFingerprint(currentSpec);
	el.dataset.mathgraphFingerprint = fingerprint;
	el.dataset.mathgraphTheme = isObsidianDarkTheme() ? 'dark' : 'light';

	const clipWarning = surfaceZRangeClipWarning(currentSpec);
	if (clipWarning) {
		console.warn('[Math Plotter]', clipWarning);
	}

	let renderGeneration = 0;
	let debounceTimer: number | null = null;

	const runRender = async (mode: RenderMode) => {
		const generation = ++renderGeneration;
		const themeIsDark = isObsidianDarkTheme();
		el.dataset.mathgraphTheme = themeIsDark ? 'dark' : 'light';
		const cacheKey = renderCacheKey(fingerprint, mode, themeIsDark);
		const cached = getCachedGraphRender(fingerprint, mode, themeIsDark);

		if (cached?.result.ok && cached.result.dataUrl) {
			if (generation !== renderGeneration) {
				return;
			}
			el.dataset.mathgraphRenderMode = mode;
			el.querySelector('.mathgraph-loading')?.remove();
			void setupGraphView(
				el,
				plugin,
				ctx,
				source,
				currentSpec,
				cached.result,
				cached.tikz ?? '',
				() => scheduleRender('svgFast', true),
				mode === 'svgFast',
			);
			return;
		}

		let bundle: Awaited<ReturnType<typeof buildGraphRenderBundle>> | undefined;
		try {
			let result: Awaited<ReturnType<typeof plugin.renderer.renderGraph>>;
			let tikz = '';

			if (mode === 'svgFast' && plugin.renderer.canRenderFast(currentSpec)) {
				if (generation !== renderGeneration) {
					return;
				}
				ensureLoading('Drawing graph…');
				result = await plugin.renderer.renderFastSpec(currentSpec, undefined, fingerprint);
			} else if (mode === 'svgFast') {
				if (generation !== renderGeneration) {
					return;
				}
				el.querySelector('.mathgraph-loading')?.remove();
				appendGraphError(el, 'Fast preview is not available for this graph type.', {
					actions: [
						{
							label: 'High quality render',
							onClick: () => {
								el.empty();
								el.addClass('mathgraph-processor-root');
								decorateMathGraphRoot(el);
								el.createDiv({ cls: 'mathgraph-loading', text: 'High-quality rendering…' });
								void runRender('tikzjax');
							},
							primary: true,
						},
					],
				});
				return;
			} else {
				if (shouldUseOctave(currentSpec, plugin.settings)) {
					ensureLoading('Sampling graph with Octave…');
				} else if (shouldUseJsSampling(currentSpec)) {
					ensureLoading('Sampling graph…');
				} else {
					ensureLoading('Preparing graph…');
				}

				bundle = await buildGraphRenderBundle(currentSpec, plugin.settings, { renderMode: mode });
				if (generation !== renderGeneration) {
					return;
				}

				ensureLoading(mode === 'tikzjax' ? 'High-quality rendering…' : 'Rendering graph…');
				result = await plugin.renderer.renderGraph(currentSpec, {
					mode,
					tikz: bundle.tikz,
					assets: bundle.assets,
					specFingerprint: fingerprint,
				});
				tikz = bundle.tikz;
			}

			if (generation !== renderGeneration) {
				return;
			}

			if (result.ok && result.dataUrl) {
				setCachedGraphRender({
					cacheKey,
					renderMode: mode,
					result,
					tikz,
				});
			}

			el.dataset.mathgraphRenderMode = mode;
			el.querySelector('.mathgraph-loading')?.remove();
			void setupGraphView(
				el,
				plugin,
				ctx,
				source,
				currentSpec,
				result,
				tikz,
				() => scheduleRender('svgFast', true),
				mode === 'svgFast',
			);
		} catch (err) {
			if (generation !== renderGeneration) {
				return;
			}
			el.querySelector('.mathgraph-loading')?.remove();
			const detailParts: string[] = [];
			if (err instanceof OctaveEngineError && err.rawLog) {
				detailParts.push(err.rawLog);
			}
			if (bundle?.octaveDebug) {
				detailParts.push(formatOctaveRenderDebugDetails(bundle.octaveDebug));
			}
			if (plugin.settings.debugMode && bundle?.tikz) {
				detailParts.push(`--- generated TikZ ---\n${bundle.tikz}`);
			}
			appendGraphError(el, err instanceof Error ? err.message : 'Could not render graph.', {
				details: detailParts.length > 0 ? detailParts.join('\n\n') : (err instanceof Error ? err.stack : undefined),
				onRetry: () => {
					el.empty();
					el.addClass('mathgraph-processor-root');
					decorateMathGraphRoot(el);
					el.createDiv({ cls: 'mathgraph-loading', text: 'Drawing graph…' });
					scheduleRender('svgFast', true);
				},
			});
		}
	};

	const scheduleRender = (mode: RenderMode, immediate = false) => {
		if (debounceTimer !== null) {
			window.clearTimeout(debounceTimer);
			debounceTimer = null;
		}

		const cached = getCachedGraphRender(fingerprint, mode, isObsidianDarkTheme());
		const delay = immediate || cached?.result.ok ? 0 : RENDER_DEBOUNCE_MS;
		debounceTimer = window.setTimeout(() => {
			debounceTimer = null;
			void runRender(mode);
		}, delay);
	};

	const triggerThemeRerender = (options?: { preserveScale?: boolean; reason?: string }) => {
		void options;
		const mode = (el.dataset.mathgraphRenderMode as RenderMode | undefined) ?? 'svgFast';
		renderGeneration++;
		if (debounceTimer !== null) {
			window.clearTimeout(debounceTimer);
			debounceTimer = null;
		}
		el.empty();
		el.addClass('mathgraph-processor-root');
		decorateMathGraphRoot(el);
		ensureLoading(mode === 'tikzjax' ? 'Updating graph…' : 'Drawing graph…');
		el.dataset.mathgraphTheme = isObsidianDarkTheme() ? 'dark' : 'light';
		scheduleRender(mode, true);
	};
	registerGraphRerenderHandler(el, triggerThemeRerender);

	scheduleRender('svgFast', Boolean(getCachedGraphRender(fingerprint, 'svgFast', isObsidianDarkTheme())?.result.ok));
}

async function setupGraphView(
	el: HTMLElement,
	plugin: MathGraphStudioPlugin,
	ctx: MarkdownPostProcessorContext,
	source: string,
	spec: GraphSpec,
	result: Parameters<typeof renderGraphView>[2],
	tikz: string,
	rerender: () => void,
	isFastPreview: boolean,
): Promise<void> {
	const location = await resolveGraphBlockLocation(plugin.app, ctx, source, el);

	renderGraphView(el, spec, result, tikz, {
		debugSource: plugin.settings.debugMode ? tikz : undefined,
		showHighQualityAction: isFastPreview && plugin.renderer.canRenderFast(spec),
		onEdit: () => void openEditModal(plugin, spec, source, ctx, el),
		onEditSize: () => void openEditModal(plugin, spec, source, ctx, el),
		onRefresh: () => {
			el.empty();
			el.addClass('mathgraph-processor-root');
			decorateMathGraphRoot(el);
			el.createDiv({ cls: 'mathgraph-loading', text: 'Drawing graph…' });
			rerender();
		},
		onHighQualityRender: () => {
			el.empty();
			el.addClass('mathgraph-processor-root');
			decorateMathGraphRoot(el);
			el.createDiv({ cls: 'mathgraph-loading', text: 'High-quality rendering…' });
			void (async () => {
				const fingerprint = specRenderFingerprint(spec);
				const themeIsDark = isObsidianDarkTheme();
				const cacheKey = renderCacheKey(fingerprint, 'tikzjax', themeIsDark);
				try {
					const bundle = await buildGraphRenderBundle(spec, plugin.settings, { renderMode: 'tikzjax' });
					const hqResult = await plugin.renderer.renderGraph(spec, {
						mode: 'tikzjax',
						tikz: bundle.tikz,
						assets: bundle.assets,
						specFingerprint: fingerprint,
					});
					if (hqResult.ok && hqResult.dataUrl) {
						setCachedGraphRender({
							cacheKey,
							renderMode: 'tikzjax',
							result: hqResult,
							tikz: bundle.tikz,
						});
					}
					el.querySelector('.mathgraph-loading')?.remove();
					void setupGraphView(
						el,
						plugin,
						ctx,
						source,
						spec,
						hqResult,
						bundle.tikz,
						rerender,
						false,
					);
				} catch (err) {
					el.querySelector('.mathgraph-loading')?.remove();
					appendGraphError(el, err instanceof Error ? err.message : 'High-quality render failed.', {
						onRetry: () => rerender(),
					});
				}
			})();
		},
		onDisplayScaleChange: newScale => {
			if (!location) {
				new Notice('Could not locate graph block to save size.');
				return;
			}

			const size = ensureGraphSize(spec);
			size.displayScale = clampDisplayScale(newScale);
			spec.size = size;

			const container = el.querySelector('.mathgraph-rendered-container');
			if (isHTMLElement(container)) {
				applyRenderedGraphDisplayScale(container, spec, result.svgText);
			}

			scheduleDisplayScaleSave(plugin, location, spec);
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
