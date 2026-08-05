import fs from 'fs';
import path from 'path';
import esbuild from 'esbuild';
import { builtinModules } from 'module';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'node_modules/node-tikzjax');
const destDir = path.join(root, 'assets/tikzjax/node');
const cssDest = path.join(root, 'assets/tikzjax/fonts.css');
const manifestDest = path.join(root, 'assets/tikzjax/manifest.json');
const bundledEntry = path.join(destDir, 'dist/index.js');
const jsdomWorkerDest = path.join(destDir, 'dist/xhr-sync-worker.js');

const PACKAGED_ASSET_FILES = [
	'assets/tikzjax/node/dist/index.js',
	'assets/tikzjax/node/dist/xhr-sync-worker.js',
	'assets/tikzjax/node/tex/tex.wasm.gz',
	'assets/tikzjax/node/tex/core.dump.gz',
	'assets/tikzjax/node/tex/tex_files.tar.gz',
	'assets/tikzjax/fonts.css',
];

if (!fs.existsSync(sourceDir)) {
	console.error('node-tikzjax is not installed. Run npm install first.');
	process.exit(1);
}

function patchJsdomXhrWorkerPath() {
	return {
		name: 'patch-jsdom-xhr-worker-path',
		setup(build) {
			build.onLoad({ filter: /XMLHttpRequest-impl\.js$/ }, async args => {
				const source = await fs.promises.readFile(args.path, 'utf8');
				return {
					contents: source.replace(
						'const syncWorkerFile = require.resolve ? require.resolve("./xhr-sync-worker.js") : null;',
						'const syncWorkerFile = require("path").join(__dirname, "xhr-sync-worker.js");',
					),
					loader: 'js',
				};
			});
		},
	};
}

async function bundleTikzJaxRuntime() {
	fs.rmSync(destDir, { recursive: true, force: true });
	fs.mkdirSync(path.dirname(bundledEntry), { recursive: true });

	await esbuild.build({
		entryPoints: [path.join(sourceDir, 'dist/index.js')],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		target: 'node16',
		outfile: bundledEntry,
		logLevel: 'info',
		external: builtinModules,
		plugins: [patchJsdomXhrWorkerPath()],
	});

	await esbuild.build({
		entryPoints: [path.join(root, 'node_modules/jsdom/lib/jsdom/living/xhr/xhr-sync-worker.js')],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		target: 'node16',
		outfile: jsdomWorkerDest,
		logLevel: 'info',
		external: builtinModules,
		plugins: [patchJsdomXhrWorkerPath()],
	});

	fs.cpSync(path.join(sourceDir, 'tex'), path.join(destDir, 'tex'), { recursive: true });
	fs.mkdirSync(path.dirname(cssDest), { recursive: true });
	fs.cpSync(path.join(sourceDir, 'css/fonts.css'), cssDest);
	fs.writeFileSync(manifestDest, JSON.stringify({
		version: 1,
		module: PACKAGED_ASSET_FILES[0],
		files: PACKAGED_ASSET_FILES,
	}, null, 2));
	console.log('Bundled TikZJax assets to assets/tikzjax/');
}

bundleTikzJaxRuntime().catch(err => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
