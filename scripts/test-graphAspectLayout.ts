import {
	graphUses2dAspectRatio,
	resolveAutoLatex2dDimensions,
	resolveFastSvgPlotDimensions,
	resolveRangeAspectRatio,
} from '../src/graphAspectLayout';
import { ensureGraphSize, resolveLatexGraphDimensions } from '../src/graphSize';
import type { GraphSpec } from '../src/graphSpec';

let failed = 0;

function assert(condition: boolean, message: string): void {
	if (!condition) {
		failed++;
		console.error(`FAIL: ${message}`);
	}
}

function wideSpec(): GraphSpec {
	return {
		version: 1,
		type: 'function2d',
		ranges: { x: ['-10', '10'], y: ['-1', '1'] },
		size: { preset: 'large', aspectMode: 'auto', displayScale: 1 },
	};
}

function tallSpec(): GraphSpec {
	return {
		version: 1,
		type: 'function2d',
		ranges: { x: ['-2', '2'], y: ['-10', '10'] },
		size: { preset: 'large', aspectMode: 'auto', displayScale: 1 },
	};
}

function squareSpec(): GraphSpec {
	return {
		version: 1,
		type: 'function2d',
		ranges: { x: ['-5', '5'], y: ['-5', '5'] },
		size: { preset: 'large', aspectMode: 'auto', displayScale: 1 },
	};
}

assert(graphUses2dAspectRatio(wideSpec()), 'function2d uses aspect');
assert(!graphUses2dAspectRatio({ version: 1, type: 'surface3d' }), '3D excluded');

const wideAspect = resolveRangeAspectRatio(wideSpec());
const tallAspect = resolveRangeAspectRatio(tallSpec());
const squareAspect = resolveRangeAspectRatio(squareSpec());

assert(wideAspect > 1.5, `wide aspect should be > 1.5, got ${wideAspect}`);
assert(tallAspect < 0.7, `tall aspect should be < 0.7, got ${tallAspect}`);
assert(Math.abs(squareAspect - 1) < 0.01, `square aspect should be ~1, got ${squareAspect}`);

const widePlot = resolveFastSvgPlotDimensions(wideSpec(), ensureGraphSize(wideSpec()));
const tallPlot = resolveFastSvgPlotDimensions(tallSpec(), ensureGraphSize(tallSpec()));
const squarePlot = resolveFastSvgPlotDimensions(squareSpec(), ensureGraphSize(squareSpec()));

assert(widePlot.plotWidth > widePlot.plotHeight, 'wide graph plot should be wider than tall');
assert(tallPlot.plotHeight > tallPlot.plotWidth, 'tall graph plot should be taller than wide');
assert(Math.abs(widePlot.plotWidth / widePlot.plotHeight - wideAspect) < 0.08, 'wide plot ratio matches aspect');
assert(Math.abs(tallPlot.plotWidth / tallPlot.plotHeight - tallAspect) < 0.08, 'tall plot ratio matches aspect');
assert(Math.abs(squarePlot.plotWidth / squarePlot.plotHeight - 1) < 0.15, 'square plot should be near square');

const wideLatex = resolveAutoLatex2dDimensions(wideSpec(), ensureGraphSize(wideSpec()));
const fixedLatex = resolveLatexGraphDimensions({
	...wideSpec(),
	size: { preset: 'large', aspectMode: 'fixed', displayScale: 1 },
});

assert(wideLatex.width === '16cm', `wide latex width should cap at 16cm, got ${wideLatex.width}`);
assert(parseFloat(wideLatex.height) < parseFloat(fixedLatex.height), 'auto wide graph should be shorter than fixed preset height');

if (failed === 0) {
	console.log('All graph aspect layout tests passed.');
} else {
	process.exit(1);
}
