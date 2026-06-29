import type { MathGraphSettings, RenderOutputFormat } from './settings';
import { DEFAULT_SETTINGS } from './settings';

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRenderOutputFormat(value: unknown): value is RenderOutputFormat {
	return value === 'svg' || value === 'png';
}

export function pickValidSettings(data: Record<string, unknown>): Partial<MathGraphSettings> {
	const picked: Partial<MathGraphSettings> = {};

	if (typeof data.enableOctaveEngine === 'boolean') {
		picked.enableOctaveEngine = data.enableOctaveEngine;
	}
	if (typeof data.octavePath === 'string') {
		picked.octavePath = data.octavePath;
	}
	if (typeof data.preferOctaveFor3dSurfaces === 'boolean') {
		picked.preferOctaveFor3dSurfaces = data.preferOctaveFor3dSurfaces;
	}
	if (typeof data.preferOctaveForOdePdeNumeric === 'boolean') {
		picked.preferOctaveForOdePdeNumeric = data.preferOctaveForOdePdeNumeric;
	}
	if (typeof data.useLocalLuaLatexFallback === 'boolean') {
		picked.useLocalLuaLatexFallback = data.useLocalLuaLatexFallback;
	}
	if (typeof data.lualatexPath === 'string') {
		picked.lualatexPath = data.lualatexPath;
	}
	if (isRenderOutputFormat(data.renderOutputFormat)) {
		picked.renderOutputFormat = data.renderOutputFormat;
	}
	if (typeof data.debugMode === 'boolean') {
		picked.debugMode = data.debugMode;
	}

	return picked;
}

export function mergeLoadedSettings(loaded: unknown): MathGraphSettings {
	const data = isRecord(loaded) ? loaded : {};
	return {
		...DEFAULT_SETTINGS,
		...pickValidSettings(data),
	};
}
