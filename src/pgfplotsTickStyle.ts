/** PGFPlots axis options that prefer text-mode tick labels over TeX math minus glyphs. */
export function pgfplotsTextSafeTickOptions(): string {
	return [
		'/pgf/number format/.cd, fixed',
		'every tick label/.style={font=\\sffamily}',
	].join(', ');
}
