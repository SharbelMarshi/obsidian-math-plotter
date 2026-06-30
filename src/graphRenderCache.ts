import type { RenderImageResult } from '../render/types';
import type { RenderMode } from '../render/renderMode';
import type { GraphSpec } from './graphSpec';
import { applyRenderedGraphLayoutScale } from './displayScaleLayout';
import { isHTMLElement } from './domUtils';

/** Fingerprint for render caching — ignores displayScale-only changes. */
export function specRenderFingerprint(spec: GraphSpec): string {
	const copy = structuredClone(spec);
	if (copy.size) {
		delete copy.size.displayScale;
	}
	return JSON.stringify(copy);
}

export function renderCacheKey(fingerprint: string, mode: RenderMode, isDark: boolean): string {
	return `${mode}:${isDark ? 'dark' : 'light'}:${fingerprint}`;
}

export function applyDisplayScaleToRoot(root: HTMLElement, spec: GraphSpec, svgText?: string): void {
	const container = root.querySelector('.mathgraph-rendered-container');
	if (isHTMLElement(container)) {
		applyRenderedGraphLayoutScale(container, spec, { svgText });
	}
}

export interface CachedGraphRender {
	cacheKey: string;
	renderMode: RenderMode;
	result: RenderImageResult;
	tikz?: string;
}

const renderCache = new Map<string, CachedGraphRender>();

export function getCachedGraphRender(
	fingerprint: string,
	mode: RenderMode,
	isDark: boolean,
): CachedGraphRender | undefined {
	return renderCache.get(renderCacheKey(fingerprint, mode, isDark));
}

export function setCachedGraphRender(entry: CachedGraphRender): void {
	renderCache.set(entry.cacheKey, entry);
	if (renderCache.size > 64) {
		const nextKey = renderCache.keys().next();
		if (!nextKey.done && nextKey.value !== undefined) {
			renderCache.delete(nextKey.value);
		}
	}
}

export function clearGraphRenderCache(): void {
	renderCache.clear();
}
