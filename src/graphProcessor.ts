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
import { clampDisplayScale, ensureGraphSize, isGraph3dView } from './graphSize';
import {
	clampElevationDeg,
	defaultGraphSpec,
	hydrateGraphSpec,
	normalizeAzimuthDeg,
	resolveGraphRotation,
	serializeGraphSpec,
	type GraphSpec,
} from './graphSpec';
import {
	getCachedGraphRender,
	setCachedGraphRender,
	specRenderFingerprint,
	renderCacheKey,
	applyDisplayScaleToRoot,
} from './graphRenderCache';
import {
	appendGraphError,
	applyRenderedGraphDisplayScale,
	inferGraphErrorLocation,
	renderGraphView,
} from './graphView';
import { GraphBuilderModal } from './graphBuilderModal';
import { captureScrollPosition, restoreScrollPosition } from './scrollPreserve';
import { decorateMathGraphRoot } from './uiStyle';
import { isObsidianDarkTheme, resolveGraphThemeColors } from './graphThemeColors';
import { renderFastSvg } from '../render/FastSvgRenderer';
import { svgDataUrl } from '../render/svgPostProcess';
import { attachComputedCoordinates } from './graphPointResolution';
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

		const hasRenderedGraph = el.querySelector('.mathgraph-rendered-container') !== null;

		if (classification.state === 'valid' && classification.spec) {
			const hydrated = hydrateGraphSpec(structuredClone(classification.spec), plugin.settings);
			const fingerprint = specRenderFingerprint(hydrated);
			const prevFingerprint = el.dataset.mathgraphFingerprint;
			const themeKey = isObsidianDarkTheme() ? 'dark' : 'light';
			const prevTheme = el.dataset.mathgraphTheme;

			if (hasRenderedGraph && prevFingerprint === fingerprint && prevTheme === themeKey) {
				el.dataset.mathgraphFingerprint = fingerprint;
				el.dataset.mathgraphTheme = themeKey;
				applyDisplayScaleToRoot(el, hydrated);
				return;
			}
		}

		// Keep the current graph visible while a changed spec re-renders — no blank flash.
		if (!(classification.state === 'valid' && hasRenderedGraph)) {
			el.empty();
		}
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

		const spec = classification.spec;
		if (!spec) {
			renderInvalidBlock(plugin, el, ctx, source, 'Invalid graph block.');
			return;
		}

		renderValidBlock(plugin, el, ctx, source, spec);
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
		// A rendered graph is still on screen (spec changed) — keep showing it instead of a spinner.
		if (el.querySelector('.mathgraph-rendered-container')) {
			return el;
		}
		return el.createDiv({ cls: 'mathgraph-loading', text });
	};

	const currentSpec = hydrateGraphSpec(structuredClone(spec), plugin.settings);
	const fingerprint = specRenderFingerprint(currentSpec);
	// With a pre-cached fast render (e.g. right after a rotation save) skip the spinner —
	// the cached graph appears immediately.
	if (!getCachedGraphRender(fingerprint, 'svgFast', isObsidianDarkTheme())?.result.ok) {
		ensureLoading();
	}
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
			);
		} catch (err) {
			if (generation !== renderGeneration) {
				return;
			}
			el.querySelector('.mathgraph-loading')?.remove();
			// A stale graph may still be on screen from the no-flash path — clear it for the error.
			if (el.querySelector('.mathgraph-rendered-container')) {
				el.empty();
				el.addClass('mathgraph-processor-root');
				decorateMathGraphRoot(el);
			}
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
				codeFrame: plugin.settings.debugMode && bundle?.tikz
					? {
						source: bundle.tikz,
						location: inferGraphErrorLocation(
							bundle.tikz,
							[
								err instanceof Error ? err.message : undefined,
								...detailParts,
							],
							err instanceof Error && typeof (err as unknown as { line?: unknown }).line === 'number'
								? (err as unknown as { line: number }).line
								: undefined,
						),
						label: 'Generated source',
					}
					: undefined,
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

function setupGraphView(
	el: HTMLElement,
	plugin: MathGraphStudioPlugin,
	ctx: MarkdownPostProcessorContext,
	source: string,
	spec: GraphSpec,
	result: Parameters<typeof renderGraphView>[2],
	tikz: string,
	rerender: () => void,
): void {
	// Resolved lazily: rendering must not wait on a disk read, and resolution can fail
	// at render time anyway (the editor buffer may not be on disk yet).
	let location: GraphBlockLocation | null = null;

	const ensureLocation = async (): Promise<GraphBlockLocation | null> => {
		if (location) {
			return location;
		}
		location = await resolveGraphBlockLocation(plugin.app, ctx, source, el);
		return location;
	};

	/**
	 * Saving rewrites the block, so Obsidian discards this element and re-runs the
	 * processor on a fresh one. Pre-cache the final fast render under the fingerprint
	 * that re-run will compute, so the new element shows the graph instantly instead
	 * of flashing "Drawing graph…".
	 */
	const cacheFinalFastRender = () => {
		if (!plugin.renderer.canRenderFast(spec)) {
			return;
		}
		try {
			// Round-trip through serialization so the fingerprint matches the re-parsed block.
			const roundTripped = hydrateGraphSpec(
				JSON.parse(serializeGraphSpec(spec)) as GraphSpec,
				plugin.settings,
			);
			const svgText = renderFastSvg(roundTripped, resolveGraphThemeColors());
			const fingerprint = specRenderFingerprint(roundTripped);
			const themeIsDark = isObsidianDarkTheme();
			setCachedGraphRender({
				cacheKey: renderCacheKey(fingerprint, 'svgFast', themeIsDark),
				renderMode: 'svgFast',
				result: { ok: true, svgText, dataUrl: svgDataUrl(svgText) },
				tikz: '',
			});
		} catch {
			// Cache priming is best-effort — the normal render path still works without it.
		}
	};

	const commitSpecSave = (what: string) => {
		cacheFinalFastRender();
		void ensureLocation().then(resolved => {
			if (!resolved) {
				new Notice(`Could not locate graph block to save ${what}.`);
				return;
			}
			// Saving the block re-runs the processor, which re-renders with the new state.
			scheduleDisplayScaleSave(plugin, resolved, spec);
		});
	};

	// Export should reflect live rotation/point previews, not the initial render.
	let liveSvgText = result.ok && result.svgText ? result.svgText : '';

	/** Live-render the fast SVG in place (used while dragging rotation or points). */
	const refreshFastPreview = () => {
		if (!plugin.renderer.canRenderFast(spec)) {
			return;
		}
		try {
			const svgText = renderFastSvg(spec, resolveGraphThemeColors());
			const img = el.querySelector('.mathgraph-image');
			if (img instanceof HTMLImageElement) {
				img.src = svgDataUrl(svgText);
			}
			liveSvgText = svgText;
		} catch {
			// Keep the last frame if a preview render fails mid-drag.
		}
	};

	renderGraphView(el, spec, result, tikz, {
		getExportSvgText: () => liveSvgText || (result.svgText ?? ''),
		debugSource: plugin.settings.debugMode ? tikz : undefined,
		onEdit: () => void openEditModal(plugin, spec, source, ctx, el),
		onRefresh: () => {
			el.empty();
			el.addClass('mathgraph-processor-root');
			decorateMathGraphRoot(el);
			el.createDiv({ cls: 'mathgraph-loading', text: 'Drawing graph…' });
			rerender();
		},
		onDisplayScaleChange: newScale => {
			const size = ensureGraphSize(spec);
			size.displayScale = clampDisplayScale(newScale);
			spec.size = size;

			const container = el.querySelector('.mathgraph-rendered-container');
			if (isHTMLElement(container)) {
				applyRenderedGraphDisplayScale(container, spec, result.svgText);
			}

			commitSpecSave('size');
		},
		onRotateView: isGraph3dView(spec)
			? (() => {
				// Float accumulators keep sub-degree drag deltas from being lost to rounding.
				const start = resolveGraphRotation(spec);
				let liveAzimuth = start.azimuth;
				let liveElevation = start.elevation;

				return (azimuthDelta: number, elevationDelta: number, phase: 'preview' | 'commit') => {
					liveAzimuth += azimuthDelta;
					if (liveAzimuth > 180) {
						liveAzimuth -= 360;
					} else if (liveAzimuth < -180) {
						liveAzimuth += 360;
					}
					liveElevation = Math.min(90, Math.max(0, liveElevation + elevationDelta));
					spec.rotation = {
						azimuth: normalizeAzimuthDeg(liveAzimuth),
						elevation: clampElevationDeg(liveElevation),
					};

					if (phase === 'preview') {
						refreshFastPreview();
						return;
					}
					commitSpecSave('rotation');
				};
			})()
			: undefined,
		onMovePoint: (spec.points?.length ?? 0) > 0
			? (pointIndex, x, y, phase) => {
				const points = spec.points ?? [];
				const point = points[pointIndex];
				if (!point) {
					return;
				}

				const format = (value: number) => String(Number.parseFloat(value.toFixed(3)));
				point.x = format(x);
				if (isGraph3dView(spec)) {
					// 3D points move in the x/y plane; auto-z recomputes below.
					point.y = format(y);
				} else if (point.y?.trim()) {
					// Blank y means "snap to the curve" — keep it blank so it recomputes.
					point.y = format(y);
				}
				spec.points = attachComputedCoordinates(spec, points);

				if (phase === 'preview') {
					refreshFastPreview();
					return;
				}
				commitSpecSave('the point');
			}
			: undefined,
	});
}

function renderInvalidBlock(
	plugin: MathGraphStudioPlugin,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	source: string,
	message: string,
): void {
	appendGraphError(el, message, {
		details: source.trim(),
		codeFrame: {
			source: source.trim(),
			location: inferGraphErrorLocation(source.trim(), [message]),
			label: 'Graph block source',
		},
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
				label: 'Copy Source',
				onClick: async () => {
					try {
						await navigator.clipboard.writeText(source.trim());
						new Notice('Graph source copied.');
					} catch {
						new Notice('Could not copy graph source.');
					}
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
