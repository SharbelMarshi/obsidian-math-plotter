import { resolveTikzJaxModulePath } from '../src/tikzJaxPaths';
import { TikzJaxRenderer } from '../render/TikzJaxRenderer';
import { prepareTikzJaxInput } from '../render/tikzJaxSource';
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

const pluginDir = process.cwd();
const modulePath = resolveTikzJaxModulePath(pluginDir);
if (!modulePath) {
	console.error('TikZJax module not found under', pluginDir);
	process.exit(1);
}
console.log('Using TikZJax module:', modulePath);

const renderer = new TikzJaxRenderer(pluginDir);

const source = prepareTikzJaxInput([
	'\\begin{tikzpicture}',
	'\\begin{axis}[width=8cm,height=6cm,xmin=-2,xmax=2]',
	'\\addplot[thick] {x^2};',
	'\\end{axis}',
	'\\end{tikzpicture}',
].join('\n'));

(async () => {
	const result = await renderer.renderToSvg(source, lightTheme);
	if (!result.ok) {
		console.error('TikZJax integration failed:', (result as { error: string }).error);
		process.exit(1);
	}
	if (result.svgText.includes('font-family="cmsy10"') || result.svgText.includes('¡')) {
		console.error('TikZJax SVG still contains broken math-font tick labels.');
		process.exit(1);
	}
	console.log(`TikZJax integration OK (${result.svgText.length} bytes SVG).`);
})().catch(err => {
	console.error(err);
	process.exit(1);
});
