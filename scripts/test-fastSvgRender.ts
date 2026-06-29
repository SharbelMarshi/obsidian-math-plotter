import { defaultGraphSpec } from '../src/graphSpec';
import { renderFastSvg } from '../render/FastSvgRenderer';
import type { GraphThemeColors } from '../src/graphThemeColors';

const lightTheme: GraphThemeColors = {
	isDark: false,
	foreground: '#111111',
	axis: '#111111',
	grid: '#d0d0d0',
	text: '#111111',
	defaultLine: '#111111',
	defaultWireframe: '#111111',
};

const spec = defaultGraphSpec('function2d');
const svg = renderFastSvg(spec, lightTheme);

if (!svg.includes('<svg') || !svg.includes('<path')) {
	console.error('Fast SVG render failed to produce path');
	process.exit(1);
}

console.log(`Fast SVG OK (${svg.length} bytes).`);
