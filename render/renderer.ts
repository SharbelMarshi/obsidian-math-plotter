import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { shouldUseFastSvg } from '../src/fastSvgRouter';
import type { GraphSpec } from '../src/graphSpec';
import {
	RenderTimeoutError,
	execFileWithTimeout,
	formatExecError,
	readLogTail,
	resolveLuaLatex,
	resolvePdfToCairo,
} from './commandResolver';
import { FastSvgRenderer } from './FastSvgRenderer';
import {
	formatLatexErrorWithLineMapping,
	mapTidiedLineToNoteLine,
} from './latexErrorMapping';
import { DEFAULT_RENDER_MODE, type RenderMode } from './renderMode';
import { resolveGraphThemeColors } from '../src/graphThemeColors';
import { finalizeSvg, svgDataUrl } from './svgPostProcess';
import { TikzJaxRenderer, type TikzJaxFailure } from './TikzJaxRenderer';
import type { RenderErrorContext, RenderImageResult, RenderAssets } from './types';
import { USER_SOURCE_LINE_OFFSET, wrapLatexSource } from './tikzSource';

import type { MathGraphSettings } from '../src/settings';

const CACHE_MAX = 64;
const CACHE_TTL_MS = 30 * 60 * 1000;

export const DEFAULT_RENDER_TIMEOUT_SECONDS = 15;
export const RENDER_CACHE_ENABLED = true;

export type { RenderMode };
export { DEFAULT_RENDER_MODE };

export type RenderSettingsProvider = () => Pick<
	MathGraphSettings,
	'lualatexPath' | 'useLocalLuaLatexFallback'
>;

interface CacheEntry {
	svgText: string;
	createdAt: number;
}

function cacheKey(
	rendererMode: RenderMode,
	source: string,
	invertDark: boolean,
	assets?: RenderAssets,
	specFingerprint?: string,
): string {
	const assetPart = assets
		? createHash('sha256').update(JSON.stringify(Object.entries(assets).sort())).digest('hex')
		: '';
	return createHash('sha256')
		.update(rendererMode)
		.update(specFingerprint ?? source)
		.update(assetPart)
		.update(invertDark ? ':dark' : ':light')
		.digest('hex');
}

export type TikzJaxFontLoader = () => void;

export class GraphRenderer {
	private cache = new Map<string, CacheEntry>();
	private inFlight = new Map<string, Promise<RenderImageResult>>();
	private readonly tikzJax: TikzJaxRenderer;
	private readonly fastSvg = new FastSvgRenderer();
	private readonly pluginBaseDir: string;

	constructor(
		private readonly isDarkTheme: () => boolean,
		private readonly renderSettings: RenderSettingsProvider,
		pluginBaseDir: string,
		private readonly ensureTikzJaxFonts?: TikzJaxFontLoader,
	) {
		this.pluginBaseDir = pluginBaseDir;
		this.tikzJax = new TikzJaxRenderer(pluginBaseDir);
	}

	static tikzJaxAssetsPresent(pluginBaseDir: string): boolean {
		return TikzJaxRenderer.bundledAssetsPresent(pluginBaseDir);
	}

	canRenderFast(spec: GraphSpec): boolean {
		return shouldUseFastSvg(spec);
	}

	async renderGraph(
		spec: GraphSpec,
		options: {
			mode?: RenderMode;
			tikz?: string;
			assets?: RenderAssets;
			specFingerprint?: string;
			errorContext?: RenderErrorContext;
		} = {},
	): Promise<RenderImageResult> {
		const mode = options.mode ?? DEFAULT_RENDER_MODE;
		const invertDark = this.isDarkTheme();

		if (mode === 'svgFast' && this.canRenderFast(spec)) {
			return this.renderFastSpec(spec, invertDark, options.specFingerprint);
		}

		if (!options.tikz) {
			return {
				ok: false,
				error: 'High-quality render requires generated TikZ source.',
			};
		}

		return this.renderTikzSource(options.tikz, {
			mode: mode === 'lualatex' ? 'lualatex' : 'tikzjax',
			invertDark,
			assets: options.assets,
			errorContext: options.errorContext,
			specFingerprint: options.specFingerprint,
		});
	}

	async renderFastSpec(
		spec: GraphSpec,
		invertDark = this.isDarkTheme(),
		specFingerprint?: string,
	): Promise<RenderImageResult> {
		const fingerprint = specFingerprint ?? JSON.stringify(spec);
		const key = cacheKey('svgFast', fingerprint, invertDark, undefined, fingerprint);

		const cached = this.readCache(key);
		if (cached) {
			return cached;
		}

		const pending = this.inFlight.get(key);
		if (pending !== undefined) {
			return pending;
		}

		const renderPromise = Promise.resolve().then(() => {
			try {
				const theme = resolveGraphThemeColors();
				const svgText = this.fastSvg.render(spec, theme);
				this.remember(key, svgText);
				return { ok: true as const, svgText, dataUrl: svgDataUrl(svgText) };
			} catch (err) {
				return {
					ok: false as const,
					error: err instanceof Error ? err.message : 'Fast SVG render failed.',
					rawLog: err instanceof Error ? err.stack : String(err),
				};
			}
		}).finally(() => this.inFlight.delete(key));

		this.inFlight.set(key, renderPromise);
		return renderPromise;
	}

	async renderTikzSource(
		source: string,
		options: {
			mode?: 'tikzjax' | 'lualatex';
			invertDark?: boolean;
			assets?: RenderAssets;
			errorContext?: RenderErrorContext;
			specFingerprint?: string;
		} = {},
	): Promise<RenderImageResult> {
		const mode = options.mode ?? 'tikzjax';
		const invertDark = options.invertDark ?? this.isDarkTheme();
		const key = cacheKey(mode, source, invertDark, options.assets, options.specFingerprint);

		const cached = this.readCache(key);
		if (cached) {
			return cached;
		}

		const pending = this.inFlight.get(key);
		if (pending !== undefined) {
			return pending;
		}

		const renderPromise = this.renderTikzWithFallback(
			source,
			options.errorContext,
			invertDark,
			key,
			options.assets,
			mode,
		).finally(() => this.inFlight.delete(key));

		this.inFlight.set(key, renderPromise);
		return renderPromise;
	}

	/** @deprecated Use renderGraph or renderTikzSource */
	async renderToSvg(
		source: string,
		errorContext?: RenderErrorContext,
		assets?: RenderAssets,
	): Promise<RenderImageResult> {
		return this.renderTikzSource(source, { errorContext, assets, mode: 'tikzjax' });
	}

	clearCache(): void {
		this.cache.clear();
		this.inFlight.clear();
	}

	private readCache(key: string): RenderImageResult | null {
		if (!RENDER_CACHE_ENABLED) {
			return null;
		}
		const hit = this.cache.get(key);
		if (hit && Date.now() - hit.createdAt <= CACHE_TTL_MS) {
			this.cache.delete(key);
			this.cache.set(key, hit);
			return { ok: true, svgText: hit.svgText, dataUrl: svgDataUrl(hit.svgText) };
		}
		if (hit) {
			this.cache.delete(key);
		}
		return null;
	}

	private remember(key: string, svgText: string): void {
		if (!RENDER_CACHE_ENABLED) {
			return;
		}

		if (this.cache.has(key)) {
			this.cache.delete(key);
		}
		this.cache.set(key, { svgText, createdAt: Date.now() });
		while (this.cache.size > CACHE_MAX) {
			const nextKey = this.cache.keys().next();
			if (nextKey.done || nextKey.value === undefined) {
				break;
			}
			this.cache.delete(nextKey.value);
		}
	}

	private async renderTikzWithFallback(
		source: string,
		errorContext: RenderErrorContext | undefined,
		invertDark: boolean,
		key: string,
		assets?: RenderAssets,
		mode: 'tikzjax' | 'lualatex' = 'tikzjax',
	): Promise<RenderImageResult> {
		if (mode === 'lualatex') {
			const luaResult = await this.compileWithLuaLatex(source, errorContext, invertDark, assets);
			if (luaResult.ok && luaResult.svgText) {
				this.remember(key, luaResult.svgText);
			}
			return luaResult;
		}

		this.ensureTikzJaxFonts?.();
		await TikzJaxRenderer.loadOnce(this.pluginBaseDir);
		const theme = resolveGraphThemeColors();
		const tikzJaxResult = await this.tikzJax.renderToSvg(source, theme, assets);
		if (tikzJaxResult.ok) {
			this.remember(key, tikzJaxResult.svgText);
			return {
				ok: true,
				svgText: tikzJaxResult.svgText,
				dataUrl: svgDataUrl(tikzJaxResult.svgText),
			};
		}

		const settings = this.renderSettings();
		if (!settings.useLocalLuaLatexFallback) {
			const failure = tikzJaxResult as TikzJaxFailure;
			return {
				ok: false,
				error: failure.error,
				rawLog: failure.rawLog,
			};
		}

		const luaKey = cacheKey('lualatex', source, invertDark, assets);
		const luaResult = await this.compileWithLuaLatex(source, errorContext, invertDark, assets);
		if (luaResult.ok && luaResult.svgText) {
			this.remember(luaKey, luaResult.svgText);
		}
		return luaResult;
	}

	private latexError(
		rawError: string,
		source: string,
		errorContext?: RenderErrorContext,
		timedOut = false,
	): RenderImageResult {
		const block = errorContext?.block;
		const editor = errorContext?.editor;
		const noteLineMapper = block && editor
			? (userLine: number) => mapTidiedLineToNoteLine(
				block.startLine,
				block.endLine,
				line => editor.getLine(line),
				userLine,
			)
			: undefined;

		const mapped = formatLatexErrorWithLineMapping(
			rawError,
			source,
			USER_SOURCE_LINE_OFFSET,
			noteLineMapper,
		);

		return {
			ok: false,
			error: timedOut ? 'Timed out.' : mapped.message,
			rawLog: rawError,
			userLine: mapped.userLine,
			noteLine: mapped.noteLine,
			lineContent: mapped.lineContent,
			timedOut,
		};
	}

	private async compileWithLuaLatex(
		source: string,
		errorContext: RenderErrorContext | undefined,
		invertDark: boolean,
		assets?: RenderAssets,
	): Promise<RenderImageResult> {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-tikz-'));
		const texPath = path.join(tmpDir, 'diagram.tex');
		const pdfPath = path.join(tmpDir, 'diagram.pdf');
		const logPath = path.join(tmpDir, 'diagram.log');
		const svgPath = path.join(tmpDir, 'diagram.svg');

		try {
			if (assets) {
				for (const [name, content] of Object.entries(assets)) {
					fs.writeFileSync(path.join(tmpDir, name), content, 'utf8');
				}
			}

			fs.writeFileSync(texPath, wrapLatexSource(source, resolveGraphThemeColors()), 'utf8');

			const settings = this.renderSettings();
			const renderTimeoutMs = DEFAULT_RENDER_TIMEOUT_SECONDS * 1000;
			const lualatex = await resolveLuaLatex(settings.lualatexPath);
			if (!lualatex) {
				return {
					ok: false,
					error: 'LuaLaTeX not found. Install a TeX distribution or disable the LuaLaTeX fallback.',
					rawLog: 'Expected at /Library/TeX/texbin/lualatex\nCheck: which lualatex',
				};
			}

			try {
				await execFileWithTimeout(lualatex, [
					'-interaction=nonstopmode',
					'-halt-on-error',
					`-output-directory=${tmpDir}`,
					texPath,
				], { cwd: tmpDir, maxBuffer: 10 * 1024 * 1024 }, renderTimeoutMs);
			} catch (err) {
				const logTail = readLogTail(logPath);
				const raw = [formatExecError(err), logTail && `\n--- log ---\n${logTail}`]
					.filter(Boolean)
					.join('\n');
				return this.latexError(raw, source, errorContext, err instanceof RenderTimeoutError);
			}

			if (!fs.existsSync(pdfPath)) {
				const logTail = readLogTail(logPath);
				if (logTail) {
					return this.latexError(
						`No PDF produced.\n--- log ---\n${logTail}`,
						source,
						errorContext,
					);
				}
				return { ok: false, error: 'No PDF produced.', rawLog: 'LuaLaTeX exited without diagram.pdf.' };
			}

			const pdftocairo = await resolvePdfToCairo();
			if (!pdftocairo) {
				return {
					ok: false,
					error: 'pdftocairo not found.',
					rawLog: 'Install: brew install poppler',
				};
			}

			const renderTimeoutMs2 = DEFAULT_RENDER_TIMEOUT_SECONDS * 1000;
			try {
				await execFileWithTimeout(pdftocairo, ['-svg', pdfPath, svgPath], {
					cwd: tmpDir,
					maxBuffer: 30 * 1024 * 1024,
				}, renderTimeoutMs2);
			} catch (err) {
				return this.latexError(
					formatExecError(err),
					source,
					errorContext,
					err instanceof RenderTimeoutError,
				);
			}

			if (!fs.existsSync(svgPath)) {
				return { ok: false, error: 'No SVG produced.', rawLog: `PDF: ${pdfPath}` };
			}

			const svgText = finalizeSvg(fs.readFileSync(svgPath, 'utf8'));
			return { ok: true, svgText, dataUrl: svgDataUrl(svgText) };
		} finally {
			try {
				fs.rmSync(tmpDir, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
	}
}

/** @deprecated Use GraphRenderer */
export { GraphRenderer as TikzRenderer };
