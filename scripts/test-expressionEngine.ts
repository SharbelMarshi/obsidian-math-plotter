import {
	evaluateExpression,
	sampleFunction2D,
	sampleSurface3D,
} from '../src/ExpressionEngine';

let failed = 0;

function assert(condition: boolean, message: string): void {
	if (!condition) {
		failed++;
		console.error(`FAIL: ${message}`);
	}
}

const yAt2 = evaluateExpression('x^2', { x: 2 });
assert(yAt2 === 4, `x^2 at 2 should be 4, got ${yAt2}`);

const trig = evaluateExpression('sin^2(x)+cos^2(y)', { x: 0, y: 0 });
assert(Math.abs(trig - 1) < 1e-9, `sin^2+cos^2 at 0 should be 1, got ${trig}`);

const surface = sampleSurface3D('x^2+y^2', 0, 1, 0, 1, 2, 2);
const corner = surface.find(point => point.x === 1 && point.y === 1);
assert(corner?.z === 2, `x^2+y^2 at (1,1) should be 2, got ${corner?.z}`);

const line = sampleFunction2D('x^2', 0, 2, 3);
assert(line.length === 3 && line[2].y === 4, 'sampleFunction2D should include endpoint y=4');

if (failed === 0) {
	console.log('All ExpressionEngine tests passed.');
} else {
	console.error(`${failed} test(s) failed.`);
	process.exit(1);
}
