import * as fs from 'fs';
import * as path from 'path';

const TIKZJAX_MODULE_REL_PATHS = [
	'node_modules/node-tikzjax/dist/index.js',
	'assets/tikzjax/node/dist/index.js',
];

/** Resolve the node-tikzjax entry file from the plugin folder (with parent walk for dev layouts). */
export function resolveTikzJaxModulePath(pluginBaseDir: string): string | null {
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

	for (const root of searchRoots) {
		for (const rel of TIKZJAX_MODULE_REL_PATHS) {
			const candidate = path.join(root, rel);
			if (fs.existsSync(candidate)) {
				return candidate;
			}
		}

		try {
			return require.resolve('node-tikzjax', { paths: [root] });
		} catch {
			// try next root
		}
	}

	return null;
}

export function describeTikzJaxSearchPaths(pluginBaseDir: string): string {
	return TIKZJAX_MODULE_REL_PATHS
		.map(rel => path.join(pluginBaseDir, rel))
		.join('\n');
}
