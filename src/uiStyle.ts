import type { MathGraphSettings } from './settings';

export type MathGraphUiStyle = 'glass' | 'native';
export type RenderedGraphFrame = 'none' | 'subtle' | 'glass';

export const UI_STYLE_LABELS: Record<MathGraphUiStyle, string> = {
	glass: 'Glass',
	native: 'Native Obsidian',
};

export const RENDERED_GRAPH_FRAME_LABELS: Record<RenderedGraphFrame, string> = {
	none: 'None',
	subtle: 'Subtle',
	glass: 'Glass card',
};

export function uiStyleClassName(style: MathGraphUiStyle): string {
	return style === 'glass' ? 'mathgraph-ui-glass' : 'mathgraph-ui-native';
}

export function graphFrameClassName(frame: RenderedGraphFrame): string {
	return `mathgraph-frame-${frame}`;
}

export function applyMathGraphUiStyle(doc: Document, settings: MathGraphSettings): void {
	doc.body.classList.remove('mathgraph-ui-glass', 'mathgraph-ui-native');
	doc.body.classList.add(uiStyleClassName(settings.uiStyle));
}

export function decorateMathGraphRoot(el: HTMLElement, settings: MathGraphSettings): void {
	el.addClass(uiStyleClassName(settings.uiStyle));
}
