import {
	describeTikzJaxSearchPaths,
	resolveTikzJaxModulePath,
} from '../src/tikzJaxPaths';
import {
	prepareTikzJaxInput,
	TIKZJAX_TEX_PACKAGES,
	TIKZJAX_TIKZ_LIBRARIES,
} from './tikzJaxSource';
import { buildTikzThemeColorDefinitions, type GraphThemeColors } from '../src/graphThemeColors';
import { finalizeSvg } from './svgPostProcess';
import type { RenderAssets } from './types';

type Tex2SvgFn = (
	input: string,
	options?: {
		showConsole?: boolean;
		texPackages?: Record<string, string>;
		tikzLibraries?: string;
		addToPreamble?: string;
	},
) => Promise<string>;

type TikzJaxFailure = { ok: false; error: string; rawLog?: string };
type TikzJaxSuccess = { ok: true; svgText: string };
type TikzJaxResult = TikzJaxSuccess | TikzJaxFailure;

export type { TikzJaxFailure, TikzJaxSuccess, TikzJaxResult };

let tex2svgModule: Tex2SvgFn | null = null;
let loadedModulePath: string | null = null;
let loadPromise: Promise<void> | null = null;
let renderQueue: Promise<unknown> = Promise.resolve();

function runExclusive<T>(task: () => Promise<T>): Promise<T> {
	const next = renderQueue.then(task, task);
	renderQueue = next.then((): undefined => undefined, (): undefined => undefined);
	return next;
}

function missingAssetsMessage(pluginBaseDir: string): string {
	return [
		'TikZJax assets not found.',
		'Run `npm install && npm run build` in the plugin folder, then reload Obsidian.',
		'The plugin folder must include `assets/tikzjax/node/` or `node_modules/node-tikzjax/`.',
		'',
		'Checked paths:',
		describeTikzJaxSearchPaths(pluginBaseDir),
	].join('\n');
}

async function loadTex2Svg(pluginBaseDir: string): Promise<Tex2SvgFn> {
	if (tex2svgModule) {
		return tex2svgModule;
	}

	if (loadPromise === null) {
		loadPromise = (async () => {
			const modulePath = resolveTikzJaxModulePath(pluginBaseDir);
			if (!modulePath) {
				throw new Error(missingAssetsMessage(pluginBaseDir));
			}

			// eslint-disable-next-line @typescript-eslint/no-require-imports -- TikZJax ships as a CommonJS bundle loaded from the plugin asset folder at runtime.
			const mod = require(modulePath) as { default?: Tex2SvgFn; load?: () => Promise<void> };
			if (typeof mod.load === 'function') {
				await mod.load();
			}
			const tex2svg = mod.default ?? mod;
			if (typeof tex2svg !== 'function') {
				throw new Error('Bundled TikZJax module did not export tex2svg.');
			}
			tex2svgModule = tex2svg;
			loadedModulePath = modulePath;
		})().catch(err => {
			loadPromise = null;
			throw err;
		});
	}

	await loadPromise;
	if (!tex2svgModule) {
		throw new Error('TikZJax failed to initialize.');
	}
	return tex2svgModule;
}

export class TikzJaxRenderer {
	constructor(private readonly pluginBaseDir: string) {}

	static async loadOnce(pluginBaseDir: string): Promise<void> {
		await loadTex2Svg(pluginBaseDir);
	}

	static bundledAssetsPresent(pluginBaseDir: string): boolean {
		return resolveTikzJaxModulePath(pluginBaseDir) !== null;
	}

	static loadedFrom(): string | null {
		return loadedModulePath;
	}

	async renderToSvg(
		source: string,
		theme: GraphThemeColors,
		assets?: RenderAssets,
	): Promise<TikzJaxResult> {
		return runExclusive(async () => {
			try {
				const tex2svg = await loadTex2Svg(this.pluginBaseDir);
				const input = prepareTikzJaxInput(source, assets);
				const svgText = finalizeSvg(
					await tex2svg(input, {
						texPackages: TIKZJAX_TEX_PACKAGES,
						tikzLibraries: TIKZJAX_TIKZ_LIBRARIES,
						addToPreamble: buildTikzThemeColorDefinitions(theme),
					}),
				);
				return { ok: true, svgText };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					ok: false,
					error: message.includes('TeX engine render failed')
						? 'TikZJax could not compile this graph. Some PGFPlots features need the optional LuaLaTeX fallback.'
						: message,
					rawLog: message,
				};
			}
		});
	}
}
