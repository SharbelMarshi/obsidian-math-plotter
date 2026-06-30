import { resolveLatexGraphDimensions } from './graphSize';
import type { GraphSpec } from './graphSpec';
import { pgfplotsTextSafeTickOptions } from './pgfplotsTickStyle';

function joinOptions(options: string[]): string {
	return options.filter(Boolean).join(', ');
}

/** Theme-aware PGFPlots axis styling — requires mathgraphAxis/mathgraphGrid definitions. */
export function pgfplotsThemeAxisStyleOptions(): string {
	return joinOptions([
		'axis line style={mathgraphAxis}',
		'tick style={mathgraphAxis}',
		'tick label style={color=mathgraphAxis, font=\\small}',
		'label style={color=mathgraphAxis, font=\\small}',
		'grid style={mathgraphGrid}',
	]);
}

/** PGFPlots axis options tuned for readable 3D surface graphs. */
export function pgfplots3dAxisOptions(spec: GraphSpec): string {
	const labels = spec.labels ?? {};
	const { width, height } = resolveLatexGraphDimensions(spec);
	const xRange = spec.ranges?.x;
	const yRange = spec.ranges?.y;

	return joinOptions([
		'view={45}{28}',
		'axis lines=box',
		labels.x ? `xlabel={${labels.x}}` : 'xlabel={$x$}',
		labels.y ? `ylabel={${labels.y}}` : 'ylabel={$y$}',
		labels.z ? `zlabel={${labels.z}}` : 'zlabel={$z$}',
		'xlabel style={at={(axis description cs:1.05,0.05)},anchor=west}',
		'ylabel style={at={(axis description cs:0.05,1.05)},anchor=south}',
		'zlabel style={at={(axis description cs:0.5,1.08)},anchor=south}',
		'tick align=outside',
		pgfplotsThemeAxisStyleOptions(),
		pgfplotsTextSafeTickOptions(),
		'grid=none',
		'enlargelimits=false',
		'axis background/.style={fill=none}',
		`width=${width}`,
		`height=${height}`,
		spec.title?.trim() ? `title={${spec.title.trim()}}` : '',
		xRange ? `xmin=${xRange[0]}` : '',
		xRange ? `xmax=${xRange[1]}` : '',
		yRange ? `ymin=${yRange[0]}` : '',
		yRange ? `ymax=${yRange[1]}` : '',
	]);
}

/** Core 3D axis options without size/labels (for graphPreprocessor axis builder). */
export function pgfplots3dAxisCoreOptions(): string {
	return joinOptions([
		'view={45}{28}',
		'axis lines=box',
		'tick align=outside',
		pgfplotsThemeAxisStyleOptions(),
		pgfplotsTextSafeTickOptions(),
		'grid=none',
		'enlargelimits=false',
		'axis background/.style={fill=none}',
	]);
}
