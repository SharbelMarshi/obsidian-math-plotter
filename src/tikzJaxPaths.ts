import * as fs from 'fs';
import * as path from 'path';

const TIKZJAX_ASSET_MANIFEST_REL_PATH = 'assets/tikzjax/manifest.json';

export interface TikzJaxAssetManifest {
	version: 1;
	module: string;
	files: string[];
}

export interface TikzJaxAssetStatus {
	root: string;
	manifestPath: string;
	modulePath: string | null;
	missingFiles: string[];
	manifest: TikzJaxAssetManifest | null;
}

function candidateRoots(pluginBaseDir: string): string[] {
	const searchRoots: string[] = [pluginBaseDir];
	let dir = pluginBaseDir;
	for (let depth = 0; depth < 6; depth++) {
		const parent = path.dirname(dir);
		if (parent === dir) {
			break;
		}
		searchRoots.push(parent);
		dir = parent;
	}
	return searchRoots;
}

function isManifest(value: unknown): value is TikzJaxAssetManifest {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Partial<TikzJaxAssetManifest>;
	return candidate.version === 1
		&& typeof candidate.module === 'string'
		&& Array.isArray(candidate.files)
		&& candidate.files.every(entry => typeof entry === 'string');
}

function readManifest(manifestPath: string): TikzJaxAssetManifest | null {
	if (!fs.existsSync(manifestPath)) {
		return null;
	}

	try {
		const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
		return isManifest(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export function inspectTikzJaxAssets(pluginBaseDir: string): TikzJaxAssetStatus {
	for (const root of candidateRoots(pluginBaseDir)) {
		const manifestPath = path.join(root, TIKZJAX_ASSET_MANIFEST_REL_PATH);
		const manifest = readManifest(manifestPath);
		if (!manifest) {
			continue;
		}

		const missingFiles = manifest.files
			.map(rel => path.join(root, rel))
			.filter(candidate => !fs.existsSync(candidate));
		const modulePath = path.join(root, manifest.module);

		return {
			root,
			manifestPath,
			modulePath,
			missingFiles,
			manifest,
		};
	}

	return {
		root: pluginBaseDir,
		manifestPath: path.join(pluginBaseDir, TIKZJAX_ASSET_MANIFEST_REL_PATH),
		modulePath: null,
		missingFiles: [],
		manifest: null,
	};
}

/** Resolve the packaged TikZJax entry file from the plugin folder (with parent walk for dev layouts). */
export function resolveTikzJaxModulePath(pluginBaseDir: string): string | null {
	const status = inspectTikzJaxAssets(pluginBaseDir);
	if (!status.manifest || status.missingFiles.length > 0 || !status.modulePath) {
		return null;
	}
	return fs.existsSync(status.modulePath) ? status.modulePath : null;
}

export function describeTikzJaxSearchPaths(pluginBaseDir: string): string {
	return candidateRoots(pluginBaseDir)
		.map(root => path.join(root, TIKZJAX_ASSET_MANIFEST_REL_PATH))
		.join('\n');
}
