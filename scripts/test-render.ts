import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { graphSpecToTikz } from '../src/graphJsonConverter';
import { defaultGraphSpec } from '../src/graphSpec';
import { wrapLatexSource } from '../render/tikzSource';

const cases = [
	{ name: 'function2d', spec: defaultGraphSpec('function2d') },
	{ name: 'pde', spec: defaultGraphSpec('pde') },
	{ name: 'parametric2d', spec: defaultGraphSpec('parametric2d') },
];

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mathgraph-test-'));
const lualatex = '/Library/TeX/texbin/lualatex';

for (const testCase of cases) {
	const tikz = graphSpecToTikz(testCase.spec);
	const tex = wrapLatexSource(tikz);
	const texPath = path.join(tmpDir, `${testCase.name}.tex`);
	fs.writeFileSync(texPath, tex, 'utf8');
	console.log(`\n=== ${testCase.name} ===`);
	console.log(tikz.split('\n').slice(0, 10).join('\n'));
	try {
		execFileSync(lualatex, [
			'-interaction=nonstopmode',
			'-halt-on-error',
			`-output-directory=${tmpDir}`,
			texPath,
		], { stdio: 'pipe' });
		console.log('OK');
	} catch (err: unknown) {
		const execErr = err as { stdout?: Buffer; stderr?: Buffer };
		const out = [execErr.stdout?.toString(), execErr.stderr?.toString()].filter(Boolean).join('\n');
		console.error('FAILED');
		console.error(out.slice(-2000));
		process.exitCode = 1;
	}
}

console.log(`\nArtifacts in ${tmpDir}`);
