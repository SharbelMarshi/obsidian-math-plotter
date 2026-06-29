import {
	buildOctavePlotTableCommand,
} from '../octave/octaveDataTikz';
import {
	csvColumnsForUseCase,
	OctaveCsvValidationError,
	validateOctaveCsv,
} from '../octave/octaveCsvValidation';
import type { GraphSpec } from '../src/graphSpec';

let failed = 0;

function assert(condition: boolean, message: string): void {
	if (!condition) {
		failed++;
		console.error(`FAIL: ${message}`);
	}
}

function assertThrows(fn: () => void, message: string): void {
	try {
		fn();
		failed++;
		console.error(`FAIL: ${message} (did not throw)`);
	} catch (err) {
		if (!(err instanceof OctaveCsvValidationError)) {
			failed++;
			console.error(`FAIL: ${message} (wrong error)`, err);
		} else {
			console.log(`OK: ${message}`);
		}
	}
}

const validCsv = [
	'x,y,z',
	'-2,-2,8',
	'-1.9,-2,7.61',
	'-1.8,-2,7.24',
].join('\n');

try {
	validateOctaveCsv(validCsv, { columns: ['x', 'y', 'z'] });
	console.log('OK: valid 3D CSV passes');
} catch (err) {
	failed++;
	console.error('FAIL: valid 3D CSV should pass', err);
}

assertThrows(
	() => validateOctaveCsv('', { columns: ['x', 'y', 'z'] }),
	'empty CSV rejected',
);

assertThrows(
	() => validateOctaveCsv('a,b,c\n1,2\n', { columns: ['x', 'y', 'z'] }),
	'wrong header rejected',
);

assertThrows(
	() => validateOctaveCsv('x,y,z\n1,2\n', { columns: ['x', 'y', 'z'] }),
	'single data row rejected',
);

assertThrows(
	() => validateOctaveCsv('x,y,z\n1,2,NaN\n2,3,4\n', { columns: ['x', 'y', 'z'] }),
	'NaN rejected',
);

assertThrows(
	() => validateOctaveCsv('x,y,z\n1,2\n3,4,5\n', { columns: ['x', 'y', 'z'] }),
	'wrong column count rejected',
);

const spec = {
	samples: 40,
	samplesY: 40,
	style: {},
} as GraphSpec;

const plot3d = buildOctavePlotTableCommand(spec, 'surface3d', 'graph-data.csv');
assert(plot3d.colSepComma === true, '3D plot uses col sep=comma');
assert(
	plot3d.addplotLine.includes('col sep=comma, x=x, y=y, z=z'),
	'3D plot uses named columns',
);
assert(
	plot3d.addplotLine.includes('mesh/rows=40'),
	'3D plot includes mesh/rows',
);
assert(
	!plot3d.addplotLine.includes('index='),
	'3D plot avoids column indexes',
);

const plot2d = buildOctavePlotTableCommand(spec, 'function2d', 'graph-data.csv');
assert(
	plot2d.addplotLine.includes('col sep=comma, x=x, y=y'),
	'2D plot uses named columns',
);

assert(csvColumnsForUseCase('pde2d').join(',') === 'x,u', 'pde2d CSV columns');

if (failed > 0) {
	process.exitCode = 1;
	console.error(`\n${failed} test(s) failed.`);
} else {
	console.log('\nAll Octave CSV import tests passed.');
}
