import {
	GraphExpressionSyntaxError,
	INVALID_SYNTAX_MESSAGE,
	compileExpressionForPgfplots,
	compileExpressionForOctave,
	sanitizeUserExpressionForStorage,
	containsOctaveCompiledSyntax,
} from '../graphSyntax';

interface TestCase {
	input: string;
	expected: string;
	parameters?: Record<string, string>;
}

const PGF_CASES: TestCase[] = [
	{ input: 'sin^2(x)+cos^2(y)', expected: '(sin(deg(x)))^2+(cos(deg(y)))^2' },
	{ input: 'sin(x)*cos(y)', expected: 'sin(deg(x))*cos(deg(y))' },
	{
		input: 'exp(-2*t)*sin(x)*sin(y)',
		parameters: { t: '0.25' },
		expected: 'exp(-2*(0.25))*sin(deg(x))*sin(deg(y))',
	},
	{ input: 'e^(-x)', expected: 'exp(-x)' },
	{ input: 'e^(-x^2-y^2)', expected: 'exp(-x^2-y^2)' },
	{ input: 'sqrt(x^2+y^2)', expected: 'sqrt(x^2+y^2)' },
	{ input: 'x^2+y^2', expected: 'x^2+y^2' },
	{ input: '2*x+3', expected: '2*x+3' },
	{ input: '2sin(x)', expected: '2*sin(deg(x))' },
	{ input: '3(x+1)', expected: '3*(x+1)' },
	{ input: 'cos^3(x)', expected: '(cos(deg(x)))^3' },
	{ input: 'cos^4(y)', expected: '(cos(deg(y)))^4' },
	{ input: 'sinh(x)+cosh(y)', expected: 'sinh(x)+cosh(y)' },
	{ input: 'log(x)', expected: 'ln(x)' },
	{ input: 'ln(x)', expected: 'ln(x)' },
	{ input: '2x', expected: '2*x' },
	{ input: 'xsin(x)', expected: 'x*sin(deg(x))' },
	{ input: 'sin(deg(x))', expected: 'sin(deg(x))' },
	{ input: '(sin(deg(x)))^2', expected: '(sin(deg(x)))^2' },
];

const OCTAVE_CASES: TestCase[] = [
	{ input: 'sin^2(x)+cos^2(y)', expected: 'sin(x).^2+cos(y).^2' },
	{ input: 'x^2+y^2', expected: 'x.^2+y.^2' },
	{ input: 'sqrt(x^2+y^2)', expected: 'sqrt(x.^2+y.^2)' },
	{ input: 'exp(-2*t)*sin(x)*sin(y)', expected: 'exp(-2.*t).*sin(x).*sin(y)' },
	{ input: 'e^(-x^2-y^2)', expected: 'exp(-x.^2-y.^2)' },
	{ input: '2sin(x)', expected: '2.*sin(x)' },
	{ input: '3(x+1)', expected: '3.*(x+1)' },
	{ input: 'sin(x)*cos(y)', expected: 'sin(x).*cos(y)' },
	{ input: 'cos^3(x)', expected: 'cos(x).^3' },
	{ input: 'tan^2(x)', expected: 'tan(x).^2' },
	{ input: 'e^(-x)', expected: 'exp(-x)' },
];

let failed = 0;

console.log('PGFPlots compiler:');
for (const testCase of PGF_CASES) {
	const actual = compileExpressionForPgfplots(testCase.input, {
		variables: ['x', 'y', 'z', 't'],
		parameters: testCase.parameters ?? {},
	});
	if (actual !== testCase.expected) {
		failed++;
		console.error(`FAIL: ${testCase.input}`);
		console.error(`  expected: ${testCase.expected}`);
		console.error(`  actual:   ${actual}`);
	} else {
		console.log(`OK: ${testCase.input}`);
	}
}

console.log('\nOctave compiler:');
for (const testCase of OCTAVE_CASES) {
	const actual = compileExpressionForOctave(testCase.input, {
		variables: ['x', 'y', 'z', 't'],
		parameters: testCase.parameters ?? {},
	});
	if (actual !== testCase.expected) {
		failed++;
		console.error(`FAIL: ${testCase.input}`);
		console.error(`  expected: ${testCase.expected}`);
		console.error(`  actual:   ${actual}`);
	} else {
		console.log(`OK: ${testCase.input}`);
	}
}

try {
	compileExpressionForPgfplots('x y');
	console.error('FAIL: x y should throw');
	failed++;
} catch (err) {
	if (err instanceof GraphExpressionSyntaxError && err.message === INVALID_SYNTAX_MESSAGE) {
		console.log('OK: x y throws validation error');
	} else {
		failed++;
		console.error('FAIL: x y threw unexpected error', err);
	}
}

if (sanitizeUserExpressionForStorage('x.^2 + y.^2') !== 'x^2 + y^2') {
	failed++;
	console.error('FAIL: sanitizeUserExpressionForStorage should restore user syntax');
} else {
	console.log('OK: sanitizeUserExpressionForStorage restores user syntax');
}

if (!containsOctaveCompiledSyntax('x.^2')) {
	failed++;
	console.error('FAIL: containsOctaveCompiledSyntax should detect Octave operators');
} else {
	console.log('OK: containsOctaveCompiledSyntax detects Octave operators');
}

if (failed > 0) {
	process.exitCode = 1;
	console.error(`\n${failed} test(s) failed.`);
} else {
	console.log(`\nAll ${PGF_CASES.length + OCTAVE_CASES.length + 3} tests passed.`);
}
