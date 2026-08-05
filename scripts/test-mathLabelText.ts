import { formatLatexLabel, formatMathLabelText } from '../src/mathLabelText';

let failed = 0;

const UNICODE_CASES: Array<[string, string]> = [
	['$e^{-y}\\sin(x)$', 'e⁻ʸsin(x)'],
	['$e^{-x}\\sin(3x)$ decay', 'e⁻ˣsin(3x) decay'],
	['Heat $u_t = \\alpha u_{xx}$', 'Heat uₜ = α uₓₓ'],
	['x^2', 'x²'],
	['x^{10}', 'x¹⁰'],
	['\\theta_0', 'θ₀'],
	['\\alpha + \\beta', 'α + β'],
	['u(x,y,t)', 'u(x,y,t)'],
	['Plain title', 'Plain title'],
	['\\frac{1}{2}x', '1/2x'],
	['e^{x+y}', 'eˣ⁺ʸ'],
	['a_{n}', 'aₙ'],
	['x \\cdot y', 'x · y'],
	['\\pi r^2', 'π r²'],
	['\\sqrt{x}', '√x'],
];

console.log('formatMathLabelText:');
for (const [input, expected] of UNICODE_CASES) {
	const actual = formatMathLabelText(input);
	if (actual !== expected) {
		failed++;
		console.error(`FAIL: ${input}\n  expected: ${expected}\n  actual:   ${actual}`);
	} else {
		console.log(`OK: ${input} → ${actual}`);
	}
}

const LATEX_CASES: Array<[string, string]> = [
	['e^{-y}\\sin(x)', '$e^{-y}\\sin(x)$'],
	['$e^{-y}\\sin(x)$', '$e^{-y}\\sin(x)$'],
	['Plain title', 'Plain title'],
	['u(x,y,t)', 'u(x,y,t)'],
	['x_0', '$x_0$'],
	['', ''],
];

console.log('\nformatLatexLabel:');
for (const [input, expected] of LATEX_CASES) {
	const actual = formatLatexLabel(input);
	if (actual !== expected) {
		failed++;
		console.error(`FAIL: ${input}\n  expected: ${expected}\n  actual:   ${actual}`);
	} else {
		console.log(`OK: "${input}" → "${actual}"`);
	}
}

if (failed > 0) {
	process.exitCode = 1;
	console.error(`\n${failed} test(s) failed.`);
} else {
	console.log(`\nAll ${UNICODE_CASES.length + LATEX_CASES.length} label tests passed.`);
}
