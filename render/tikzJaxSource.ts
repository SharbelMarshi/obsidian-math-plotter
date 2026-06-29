import { inlinePlotTableAssets } from './inlinePlotAssets';
import type { RenderAssets } from './types';

const UNSUPPORTED_TIKZJAX_DIRECTIVES = [
	/\\usepackage(?:\[[^\]]*\])?\{[^}]+\}\n?/g,
	/\\usepgfplotslibrary\{fillbetween\}\n?/g,
	/\\usetikzlibrary\{intersections\}\n?/g,
	/\\pgfplotsset\{[^}]*compat\s*=\s*1\.18[^}]*\}\n?/g,
	/\\documentclass(?:\[[^\]]*\])?\{[^}]+\}\n?/g,
	/\\begin\{document\}\n?/g,
	/\\end\{document\}\n?/g,
	/\\setmainlanguage\{[^}]+\}\n?/g,
	/\\setmainfont(?:\[[^\]]*\])?\{[^}]+\}\n?/g,
];

export function sanitizeTikzForTikzJax(source: string): string {
	let cleaned = source;
	for (const pattern of UNSUPPORTED_TIKZJAX_DIRECTIVES) {
		cleaned = cleaned.replace(pattern, '');
	}
	return cleaned.trim();
}

export function prepareTikzJaxInput(source: string, assets?: RenderAssets): string {
	const withInlineTables = assets ? inlinePlotTableAssets(source, assets) : source;
	const body = sanitizeTikzForTikzJax(withInlineTables);

	return [
		'\\begin{document}',
		'\\pgfplotsset{compat=1.16}',
		body,
		'\\end{document}',
	].join('\n');
}

export const TIKZJAX_TEX_PACKAGES: Record<string, string> = {
	pgfplots: '',
	amsmath: '',
};

export const TIKZJAX_TIKZ_LIBRARIES = 'arrows.meta,calc,decorations.pathmorphing,decorations.pathreplacing';
