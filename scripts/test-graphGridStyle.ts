import { applyGridStyleToTikz, gridAxisOption, gridEnabledForGraph } from '../src/graphGridStyle';
import type { GraphSpec } from '../src/graphSpec';

let failed = 0;

function assert(condition: boolean, message: string): void {
	if (!condition) {
		failed++;
		console.error(`FAIL: ${message}`);
	}
}

const function2d: GraphSpec = {
	version: 1,
	type: 'function2d',
	style: { grid: false },
};

assert(gridEnabledForGraph(function2d) === false, 'grid false should disable grid');
assert(gridAxisOption(function2d) === 'grid=none', 'disabled grid should emit grid=none');

const legacy: GraphSpec = { version: 1, type: 'function2d' };
assert(gridEnabledForGraph(legacy) === true, 'missing grid should default to on');

const surface: GraphSpec = { version: 1, type: 'surface3d', style: { grid: false } };
assert(gridAxisOption(surface) === 'grid=none', '3D surfaces use grid=none');

const tikzOn = applyGridStyleToTikz('\\begin{axis}[grid=both,axis lines=middle]', function2d);
assert(tikzOn.includes('grid=none'), 'applyGridStyleToTikz should replace grid=both');

if (failed === 0) {
	console.log('All graph grid style tests passed.');
} else {
	console.error(`${failed} test(s) failed.`);
	process.exit(1);
}
