import { inlinePlotTableAssets } from '../render/inlinePlotAssets';
import { prepareTikzJaxInput } from '../render/tikzJaxSource';

let failed = 0;

function assert(condition: boolean, message: string): void {
	if (!condition) {
		failed++;
		console.error(`FAIL: ${message}`);
	}
}

const tikz = [
	'\\begin{tikzpicture}',
	'\\begin{axis}',
	'\\addplot table[col sep=comma, x=x, y=y] {graph-data.csv};',
	'\\end{axis}',
	'\\end{tikzpicture}',
].join('\n');

const assets = {
	'graph-data.csv': 'x,y\n0,0\n1,1\n',
};

const inlined = inlinePlotTableAssets(tikz, assets);
assert(inlined.includes('0,0'), 'inline table should contain CSV rows');
assert(!inlined.includes('graph-data.csv'), 'filename should be replaced');

const prepared = prepareTikzJaxInput(inlined);
assert(prepared.includes('\\begin{document}'), 'TikZJax input needs document wrapper');
assert(prepared.includes('compat=1.16'), 'TikZJax uses pgfplots compat 1.16');

if (failed === 0) {
	console.log('All TikZJax source tests passed.');
} else {
	console.error(`${failed} test(s) failed.`);
	process.exit(1);
}
