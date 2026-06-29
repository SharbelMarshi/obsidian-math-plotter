/** Replace external PGFPlots table files with inline CSV data for TikZJax. */
export function inlinePlotTableAssets(tikz: string, assets: Record<string, string>): string {
	let result = tikz;

	for (const [filename, csvContent] of Object.entries(assets)) {
		const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const pattern = new RegExp(
			`(\\\\addplot3?(?:\\[[^\\]]*\\])?\\s*table\\[[^\\]]*\\]\\s*\\{)${escaped}(\\})`,
			'g',
		);
		result = result.replace(pattern, (_match, prefix: string) => {
			return `${prefix}\n${csvContent.trim()}\n}`;
		});
	}

	return result;
}
