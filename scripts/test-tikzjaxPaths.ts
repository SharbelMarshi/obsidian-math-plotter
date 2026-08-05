import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveTikzJaxModulePath } from '../src/tikzJaxPaths';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mathgraph-tikzjax-paths-'));
const assetsDir = path.join(tempRoot, 'assets/tikzjax');
const packagedModule = path.join(tempRoot, 'assets/tikzjax/node/dist/index.js');
const packageJsonModule = path.join(tempRoot, 'node_modules/node-tikzjax/dist/index.js');

try {
	fs.mkdirSync(path.dirname(packagedModule), { recursive: true });
	fs.mkdirSync(path.dirname(packageJsonModule), { recursive: true });
	fs.writeFileSync(packagedModule, 'module.exports = () => "packaged";\n');
	fs.writeFileSync(path.join(tempRoot, 'assets/tikzjax/node/dist/xhr-sync-worker.js'), 'module.exports = {};\n');
	fs.mkdirSync(path.join(tempRoot, 'assets/tikzjax/node/tex'), { recursive: true });
	fs.writeFileSync(path.join(tempRoot, 'assets/tikzjax/node/tex/tex.wasm.gz'), '');
	fs.writeFileSync(path.join(tempRoot, 'assets/tikzjax/node/tex/core.dump.gz'), '');
	fs.writeFileSync(path.join(tempRoot, 'assets/tikzjax/node/tex/tex_files.tar.gz'), '');
	fs.writeFileSync(path.join(tempRoot, 'assets/tikzjax/fonts.css'), '');
	fs.writeFileSync(packageJsonModule, 'module.exports = () => "node_modules";\n');
	fs.writeFileSync(path.join(assetsDir, 'manifest.json'), JSON.stringify({
		version: 1,
		module: 'assets/tikzjax/node/dist/index.js',
		files: [
			'assets/tikzjax/node/dist/index.js',
			'assets/tikzjax/node/dist/xhr-sync-worker.js',
			'assets/tikzjax/node/tex/tex.wasm.gz',
			'assets/tikzjax/node/tex/core.dump.gz',
			'assets/tikzjax/node/tex/tex_files.tar.gz',
			'assets/tikzjax/fonts.css',
		],
	}, null, 2));

	const resolved = resolveTikzJaxModulePath(tempRoot);
	if (resolved !== packagedModule) {
		console.error('FAIL: packaged TikZJax assets should be preferred over node_modules fallback.');
		console.error('Resolved:', resolved);
		console.error('Expected:', packagedModule);
		process.exitCode = 1;
	} else {
		console.log('TikZJax packaged asset preference OK.');
	}
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
