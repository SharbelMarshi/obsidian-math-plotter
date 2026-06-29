import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
	path.join(root, 'assets/tikzjax/node/dist/index.js'),
	path.join(root, 'assets/tikzjax/node/tex/tex.wasm.gz'),
	path.join(root, 'assets/tikzjax/node/tex/core.dump.gz'),
];

const missing = required.filter(file => !fs.existsSync(file));
if (missing.length > 0) {
	console.error('TikZJax bundle verification failed. Missing files:');
	for (const file of missing) {
		console.error(`  - ${file}`);
	}
	process.exit(1);
}

console.log('TikZJax bundle verified.');
