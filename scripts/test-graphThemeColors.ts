import {
	buildTikzThemeColorDefinitions,
	cssColorToTikzHtml,
	resolveGraphThemeColors,
} from '../src/graphThemeColors';

let failed = 0;

function assert(condition: boolean, message: string): void {
	if (!condition) {
		failed++;
		console.error(`FAIL: ${message}`);
	}
}

const lightDoc = { body: { classList: { contains: () => false } } } as unknown as Document;
const light = resolveGraphThemeColors(lightDoc);
assert(!light.isDark, 'light theme is not dark');
assert(light.defaultLine === '#111111', 'light default line fallback');
assert(light.grid === '#d0d0d0', 'light grid fallback');

const darkDoc = { body: { classList: { contains: (c: string) => c === 'theme-dark' } } } as unknown as Document;
const dark = resolveGraphThemeColors(darkDoc);
assert(dark.isDark, 'dark theme detected');
assert(dark.defaultLine === '#f2f2f2', 'dark default line fallback');
assert(dark.defaultWireframe === '#f2f2f2', 'dark wireframe fallback');

assert(cssColorToTikzHtml('#111111') === '111111', 'hex to tikz html');
assert(cssColorToTikzHtml('rgb(242, 242, 242)') === 'F2F2F2', 'rgb to tikz html');

const defs = buildTikzThemeColorDefinitions(dark);
assert(defs.includes('\\definecolor{mathgraphAxis}'), 'axis color defined');
assert(defs.includes('\\definecolor{mathgraphGrid}'), 'grid color defined');
assert(defs.includes('\\definecolor{mathgraphLine}'), 'line color defined');
assert(defs.includes('F2F2F2'), 'dark line hex in defs');

if (failed === 0) {
	console.log('All graph theme color tests passed.');
} else {
	process.exit(1);
}
