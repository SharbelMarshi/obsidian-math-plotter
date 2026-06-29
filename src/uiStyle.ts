export const MATHGRAPH_UI_STYLE = 'glass';

export function mathgraphUiClassName(): string {
	return 'mathgraph-ui-glass';
}

export function applyMathGraphUiStyle(doc: Document): void {
	doc.body.classList.remove('mathgraph-ui-glass', 'mathgraph-ui-native');
	doc.body.classList.add(mathgraphUiClassName());
}

export function decorateMathGraphRoot(el: HTMLElement): void {
	el.addClass(mathgraphUiClassName());
}
