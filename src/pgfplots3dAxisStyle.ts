import { resolveLatexGraphDimensions } from './graphSize';
import { formatLatexLabel } from './mathLabelText';
import { latexLabelFontCommand, resolveAxisLineWidth, resolveLabelFontSize } from './renderStyleConfig';
import { resolveGraphRotation, type GraphSpec } from './graphSpec';
import { pgfplotsTextSafeTickOptions } from './pgfplotsTickStyle';

function joinOptions(options: string[]): string {
	return options.filter(Boolean).join(', ');
}

/** Emit an axis limit only when the user actually provided a value — `xmin=` breaks pgfplots. */
function limitOption(name: string, value: string | undefined): string {
	const trimmed = value?.trim() ?? '';
	return trimmed ? `${name}=${trimmed}` : '';
}

/** Theme-aware PGFPlots axis styling — requires mathgraphAxis/mathgraphGrid definitions. */
export function pgfplotsThemeAxisStyleOptions(spec?: GraphSpec): string {
	const axisWidth = Number.parseFloat(resolveAxisLineWidth(spec).toFixed(2));
	const labelFont = latexLabelFontCommand(resolveLabelFontSize(spec));
	return joinOptions([
		`axis line style={mathgraphAxis, line width=${axisWidth}pt}`,
		'tick style={mathgraphAxis}',
		'tick label style={color=mathgraphAxis, font=\\small}',
		`label style={color=mathgraphAxis, font=${labelFont}}`,
		`title style={font=${labelFont}}`,
		'grid style={mathgraphGrid}',
	]);
}

/** PGFPlots axis options tuned for readable 3D surface graphs. */
export function pgfplots3dAxisOptions(spec: GraphSpec): string {
	const labels = spec.labels ?? {};
	const { width, height } = resolveLatexGraphDimensions(spec);
	const xRange = spec.ranges?.x;
	const yRange = spec.ranges?.y;
	const rotation = resolveGraphRotation(spec);

	return joinOptions([
		`view={${rotation.azimuth}}{${rotation.elevation}}`,
		'axis lines=box',
		labels.x ? `xlabel={${formatLatexLabel(labels.x)}}` : 'xlabel={$x$}',
		labels.y ? `ylabel={${formatLatexLabel(labels.y)}}` : 'ylabel={$y$}',
		labels.z ? `zlabel={${formatLatexLabel(labels.z)}}` : 'zlabel={$z$}',
		'xlabel style={at={(axis description cs:1.05,0.05)},anchor=west}',
		'ylabel style={at={(axis description cs:0.05,1.05)},anchor=south}',
		'zlabel style={at={(axis description cs:0.5,1.08)},anchor=south}',
		'tick align=outside',
		pgfplotsThemeAxisStyleOptions(spec),
		pgfplotsTextSafeTickOptions(),
		'grid=none',
		'enlargelimits=false',
		'axis background/.style={fill=none}',
		`width=${width}`,
		`height=${height}`,
		spec.title?.trim() ? `title={${formatLatexLabel(spec.title)}}` : '',
		xRange ? limitOption('xmin', xRange[0]) : '',
		xRange ? limitOption('xmax', xRange[1]) : '',
		yRange ? limitOption('ymin', yRange[0]) : '',
		yRange ? limitOption('ymax', yRange[1]) : '',
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
