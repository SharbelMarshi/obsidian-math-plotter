import { buildTikzThemeColorDefinitions, type GraphThemeColors } from '../src/graphThemeColors';
import { getUserSourceLineOffset } from './latexErrorMapping';
import { SIMPLE_TIKZ_HELPERS } from './simpleShapes';

const DOCUMENTCLASS_LINE = '\\documentclass[tikz,border=0pt]{standalone}\n';

export const LATEX_WRAPPER_PREFIX = `${DOCUMENTCLASS_LINE}\\usepackage{fontspec}
\\usepackage{polyglossia}

\\setmainlanguage{english}

\\usepackage{tikz}
\\usetikzlibrary{arrows.meta,positioning,calc,shapes,decorations.pathmorphing}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{pgfplots}
\\usepgfplotslibrary{fillbetween}
\\usetikzlibrary{intersections}
\\pgfplotsset{
	compat=1.18,
	every axis/.append style={
		axis background/.style={fill=none},
	},
}

${SIMPLE_TIKZ_HELPERS}
\\begin{document}
`;

const LATEX_WRAPPER_SUFFIX = `
\\end{document}
`;

export const USER_SOURCE_LINE_OFFSET = getUserSourceLineOffset(LATEX_WRAPPER_PREFIX);

export function tidyTikzSource(tikzSource: string): string {
	return tikzSource
		.replaceAll('&nbsp;', '')
		.split('\n')
		.map(line => line.trim())
		.filter(Boolean)
		.join('\n');
}

export function wrapLatexSource(source: string, theme?: GraphThemeColors): string {
	let cleanedSource = source;

	cleanedSource = cleanedSource.replace(/\\documentclass(?:\[[^\]]*\])?\{[^}]+\}/g, '');
	cleanedSource = cleanedSource.replace(/\\usepackage(?:\[[^\]]*\])?\{[^}]+\}/g, '');
	cleanedSource = cleanedSource.replace(/\\pgfplotsset\{[^}]*\}/g, '');
	cleanedSource = cleanedSource.replace(/\\begin\{document\}/g, '');
	cleanedSource = cleanedSource.replace(/\\end\{document\}/g, '');
	cleanedSource = cleanedSource.replace(/\\setmainlanguage\{[^}]+\}/g, '');
	cleanedSource = cleanedSource.replace(/\\setotherlanguage\{[^}]+\}/g, '');
	cleanedSource = cleanedSource.replace(/\\setmainfont(?:\[[^\]]*\])?\{[^}]+\}/g, '');
	cleanedSource = cleanedSource.replace(/\\setsansfont(?:\[[^\]]*\])?\{[^}]+\}/g, '');
	cleanedSource = cleanedSource.replace(/\\newfontfamily\\\w+(?:\[[^\]]*\])?\{[^}]+\}/g, '');

	const themeDefs = theme ? `${buildTikzThemeColorDefinitions(theme)}\n` : '';
	return LATEX_WRAPPER_PREFIX + themeDefs + cleanedSource.trim() + LATEX_WRAPPER_SUFFIX;
}
