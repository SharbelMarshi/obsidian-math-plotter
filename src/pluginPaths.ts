import { FileSystemAdapter, Plugin } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';

/** Absolute path to the plugin install folder (directory containing main.js). */
export function resolvePluginBaseDir(plugin: Plugin): string {
	const manifestDir = plugin.manifest.dir?.trim();
	if (manifestDir) {
		const adapter = plugin.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			const candidate = path.join(adapter.getBasePath(), manifestDir);
			if (fs.existsSync(path.join(candidate, 'main.js'))) {
				return candidate;
			}
		}
	}

	if (fs.existsSync(path.join(__dirname, 'main.js'))) {
		return __dirname;
	}

	return __dirname;
}
