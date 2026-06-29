import { getGraphBaseWidthPx } from '../src/displayScaleLayout';
import type { GraphSpec } from '../src/graphSpec';

let failed = 0;

function assert(condition: boolean, message: string): void {
	if (!condition) {
		failed++;
		console.error(`FAIL: ${message}`);
	}
}

const function2d: GraphSpec = { version: 1, type: 'function2d' };
const surface3d: GraphSpec = { version: 1, type: 'surface3d' };
const ode2d: GraphSpec = { version: 1, type: 'ode', view: '2d' };
const pde3d: GraphSpec = { version: 1, type: 'pde', view: '3d' };

assert(getGraphBaseWidthPx(function2d, null) === 540, '2D fallback should be 540');
assert(getGraphBaseWidthPx(ode2d, null) === 540, 'ODE 2D fallback should be 540');
assert(getGraphBaseWidthPx(surface3d, null) === 660, '3D fallback should be 660');
assert(getGraphBaseWidthPx(pde3d, null) === 660, 'PDE 3D fallback should be 660');
assert(getGraphBaseWidthPx(function2d, 560) === 560, '2D measured 560 should stay 560');
assert(getGraphBaseWidthPx(function2d, 920) === 575, '2D measured 920 should cap at 575');
assert(getGraphBaseWidthPx(function2d, 1600) === 540, '2D oversized measured should use fallback');
assert(getGraphBaseWidthPx(surface3d, 1600) === 660, '3D oversized measured should use fallback');
assert(getGraphBaseWidthPx(function2d, 700) === 575, '2D measured 700 should cap at 575');
assert(getGraphBaseWidthPx(surface3d, 800) === 700, '3D measured 800 should cap at 700');

if (failed === 0) {
	console.log('All display scale layout tests passed.');
} else {
	process.exit(1);
}
