import { defaultGraphSpec, serializeGraphSpec, setUserFunction } from '../src/graphSpec';
import { resolveLatexGraphDimensions } from '../src/graphSize';
import {
	SURFACE_Z_CLIP_WARNING,
	surfaceZRangeClipWarning,
} from '../src/graphRangeValidation';

let failed = 0;

function assert(condition: boolean, message: string): void {
	if (!condition) {
		failed++;
		console.error(`FAIL: ${message}`);
	} else {
		console.log(`OK: ${message}`);
	}
}

const clippedSpec = defaultGraphSpec('surface3d');
setUserFunction(clippedSpec, 'x^2+y^2');
clippedSpec.ranges = {
	x: ['-2', '2'],
	y: ['-2', '2'],
	z: ['-1', '1'],
};

assert(
	surfaceZRangeClipWarning(clippedSpec) === SURFACE_Z_CLIP_WARNING,
	'x^2+y^2 warns when z range is too narrow',
);

const fitsSpec = defaultGraphSpec('surface3d');
setUserFunction(fitsSpec, 'x^2+y^2');
fitsSpec.ranges = {
	x: ['-1', '1'],
	y: ['-1', '1'],
	z: ['0', '2'],
};

assert(
	surfaceZRangeClipWarning(fitsSpec) === null,
	'x^2+y^2 does not warn when z range fits',
);

const spec = defaultGraphSpec('surface3d');
setUserFunction(spec, 'x.^2 + y.^2');
const json = serializeGraphSpec(spec);
assert(!json.includes('.^'), 'serializeGraphSpec stores user syntax without Octave operators');
assert(json.includes('x^2 + y^2'), 'serializeGraphSpec preserves restored user syntax');

const dims = resolveLatexGraphDimensions(defaultGraphSpec('surface3d'));
assert(dims.width === '15cm', 'default 3D width is 15cm');
assert(dims.height === '10cm', 'default 3D height is 10cm');

if (failed > 0) {
	process.exitCode = 1;
	console.error(`\n${failed} test(s) failed.`);
} else {
	console.log('\nAll graph range/size tests passed.');
}
