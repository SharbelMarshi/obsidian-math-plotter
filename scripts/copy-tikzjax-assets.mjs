import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'node_modules/node-tikzjax');
const destDir = path.join(root, 'assets/tikzjax/node');
const cssDest = path.join(root, 'assets/tikzjax/fonts.css');

if (!fs.existsSync(sourceDir)) {
	console.error('node-tikzjax is not installed. Run npm install first.');
	process.exit(1);
}

fs.rmSync(destDir, { recursive: true, force: true });
fs.cpSync(sourceDir, destDir, { recursive: true });

execSync('npm install --omit=dev --ignore-scripts --silent', {
	cwd: destDir,
	stdio: 'inherit',
});

fs.mkdirSync(path.dirname(cssDest), { recursive: true });
fs.cpSync(path.join(sourceDir, 'css/fonts.css'), cssDest);

console.log('Copied TikZJax assets to assets/tikzjax/');
