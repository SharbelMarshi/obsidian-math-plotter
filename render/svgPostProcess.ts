import { fixTikzJaxSvgTickLabels } from './svgTickLabelFix';

export function svgDataUrl(svgText: string): string {
	return `data:image/svg+xml;base64,${Buffer.from(svgText, 'utf8').toString('base64')}`;
}

export function invertSvgForDarkMode(svg: string): string {
	return svg
		.replaceAll('rgb(0%,0%,0%)', 'rgb(100%,100%,100%)')
		.replace(/rgb[(]0%,[ \t]*0%,[ \t]*0%[)]/g, 'rgb(100%,100%,100%)')
		.replace(/rgb[(]0,[ \t]*0,[ \t]*0[)]/g, 'rgb(255,255,255)')
		.replace(/#000000(?![0-9a-f])/gi, '#ffffff')
		.replace(/#000(?![0-9a-f])/gi, '#fff')
		.replace(/stroke:[ \t]*black/gi, 'stroke:white')
		.replace(/fill:[ \t]*black/gi, 'fill:white')
		.replace(/stroke="black"/gi, 'stroke="white"')
		.replace(/fill="black"/gi, 'fill="white"');
}

/** Remove the standalone page background rect so SVG blends with Obsidian. */
export function stripSvgPageBackground(svg: string): string {
	let result = svg;

	result = result.replace(
		/<rect[^>]*\bwidth="[^"]+"[^>]*\bheight="[^"]+"[^>]*\bfill="(?:#fff(?:fff)?|white|rgb\(100%,100%,100%\))"[^>]*\/?>/gi,
		'',
	);
	result = result.replace(
		/<rect[^>]*\bfill="(?:#fff(?:fff)?|white|rgb\(100%,100%,100%\))"[^>]*\bwidth="[^"]+"[^>]*\bheight="[^"]+"[^>]*\/?>/gi,
		'',
	);
	result = result.replace(
		/<rect[^>]*style="[^"]*fill:rgb\(100%,100%,100%\)[^"]*"[^>]*\/?>/gi,
		'',
	);

	return result;
}

export function finalizeSvg(svgText: string): string {
	let result = stripSvgPageBackground(svgText);
	result = fixTikzJaxSvgTickLabels(result);
	return result;
}
