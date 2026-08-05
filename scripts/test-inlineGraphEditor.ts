import { collectGraphEditorDiagnostics } from '../src/inlineGraphEditor';

let failed = 0;

function assert(condition: boolean, message: string): void {
	if (!condition) {
		failed++;
		console.error(`FAIL: ${message}`);
	}
}

const jsonDiagnostics = collectGraphEditorDiagnostics([
	'```graph',
	'{',
	'  "version": 1',
	'  "type": "function2d"',
	'}',
	'```',
].join('\n'));

assert(jsonDiagnostics.length === 1, 'editor diagnostics should report malformed graph JSON');
assert(jsonDiagnostics[0]?.from !== undefined, 'malformed graph JSON should include a highlight range');

const latexDiagnostics = collectGraphEditorDiagnostics(String.raw`\begin{graph}
\line
\end{graph}`);

assert(latexDiagnostics.length === 1, 'editor diagnostics should report invalid LaTeX graph commands');
assert(/\\line/.test(latexDiagnostics[0]?.message ?? ''), 'LaTeX graph diagnostic should preserve the parser error message');

const cleanDiagnostics = collectGraphEditorDiagnostics([
	'```graph',
	'{"version":1,"type":"function2d","function":"x^2"}',
	'```',
].join('\n'));

assert(cleanDiagnostics.length === 0, 'valid graph JSON should not produce editor diagnostics');

if (failed === 0) {
	console.log('Inline graph editor diagnostics OK.');
} else {
	console.error(`${failed} test(s) failed.`);
	process.exit(1);
}
