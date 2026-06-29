import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const stagingDir = path.join(root, '.release-staging');
const zipPath = path.join(root, 'math-plotter-full.zip');

const requiredFiles = ['main.js', 'manifest.json', 'styles.css'];
const requiredAssetFiles = [
	'assets/tikzjax/node/dist/index.js',
	'assets/tikzjax/node/tex/tex.wasm.gz',
	'assets/tikzjax/node/tex/core.dump.gz',
	'assets/tikzjax/fonts.css',
];

for (const file of requiredFiles) {
	const filePath = path.join(root, file);
	if (!fs.existsSync(filePath)) {
		console.error(`Cannot package release. Missing ${file}`);
		process.exit(1);
	}
}

for (const file of requiredAssetFiles) {
	const filePath = path.join(root, file);
	if (!fs.existsSync(filePath)) {
		console.error(`Cannot package release. Missing ${file}. Run npm run build first.`);
		process.exit(1);
	}
}

fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });

for (const file of requiredFiles) {
	fs.copyFileSync(path.join(root, file), path.join(stagingDir, file));
}

fs.cpSync(path.join(root, 'assets/tikzjax'), path.join(stagingDir, 'assets/tikzjax'), {
	recursive: true,
});

fs.rmSync(zipPath, { force: true });
execSync(`cd "${stagingDir}" && zip -rq "${zipPath}" .`, { stdio: 'inherit' });
fs.rmSync(stagingDir, { recursive: true, force: true });

console.log(`Created ${path.basename(zipPath)} for manual installs (includes TikZJax assets).`);
