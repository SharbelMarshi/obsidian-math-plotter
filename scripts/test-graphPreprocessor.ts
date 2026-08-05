import { expandGraphSyntax } from '../graphPreprocessor';

let failed = 0;

function assert(condition: boolean, message: string): void {
	if (!condition) {
		failed++;
		console.error(`FAIL: ${message}`);
	}
}

const expanded = expandGraphSyntax(String.raw`\begin{graph}
\function{$\sum_{i=1}^{3} i*x$}
\end{graph}`);

assert(expanded.includes('((1)*x)+((2)*x)+((3)*x)'), 'graph preprocessor should expand finite latex sums');

const latexExpanded = expandGraphSyntax(String.raw`\begin{graph}
\function{\left(\frac{1}{2}\right)\cdot x}
\end{graph}`);

assert(latexExpanded.includes('(((1)/(2)))*x'), 'graph preprocessor should normalize common LaTeX wrappers and operators');

const dfracExpanded = expandGraphSyntax(String.raw`\begin{graph}
\function{\dfrac{1}{2}x}
\end{graph}`);

assert(dfracExpanded.includes('((1)/(2))*x'), 'graph preprocessor should normalize \\dfrac expressions');

const matrixPointExpanded = expandGraphSyntax(String.raw`\begin{graph}
\point{\begin{pmatrix}1\\2\end{pmatrix}}
\end{graph}`);

assert(matrixPointExpanded.includes('coordinates {(1, 2)}'), 'graph preprocessor should accept simple matrix-style point coordinates');

if (failed === 0) {
	console.log('Graph preprocessor LaTeX support OK.');
} else {
	console.error(`${failed} test(s) failed.`);
	process.exit(1);
}
