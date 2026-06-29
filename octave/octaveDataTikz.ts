import { resolveGraphDimensions } from '../src/graphSize';
import type { GraphSpec } from '../src/graphSpec';
import type { OctavePipelineResult } from './octavePipeline';
import type { OctaveUseCase } from './octaveRouter';
import { csvColumnsForUseCase } from './octaveCsvValidation';

function joinOptions(options: string[]): string {
	return options.filter(Boolean).join(', ');
}

function axisOptions(spec: GraphSpec, view3d: boolean): string {
	const labels = spec.labels ?? {};
	const { width, height } = resolveGraphDimensions(spec);
	const xRange = spec.ranges?.x;
	const yRange = spec.ranges?.y;

	const parts = [
		'grid=both',
		'axis lines=middle',
		'axis background/.style={fill=none}',
		`width=${width}`,
		`height=${height}`,
		labels.x ? `xlabel={${labels.x}}` : '',
		labels.y ? `ylabel={${labels.y}}` : '',
		spec.title ? `title={${spec.title}}` : '',
	];

	if (view3d) {
		parts.push('view={45}{30}');
		if (labels.z) {
			parts.push(`zlabel={${labels.z}}`);
		}
	}

	if (xRange) {
		parts.push(`xmin=${xRange[0]}`, `xmax=${xRange[1]}`);
	}
	if (yRange) {
		parts.push(`ymin=${yRange[0]}`, `ymax=${yRange[1]}`);
	}

	return joinOptions(parts);
}

function plotStyleOptions(spec: GraphSpec): string {
	const style = spec.style ?? {};
	return joinOptions([
		style.color ? `${style.color}` : '',
		style.width ?? '',
	]);
}

export interface OctavePlotTableCommand {
	addplotLine: string;
	colSepComma: boolean;
	meshRows?: number;
}

function tableColumnBindings(useCase: OctaveUseCase): string {
	const columns = csvColumnsForUseCase(useCase);
	if (columns.length === 3) {
		return 'col sep=comma, x=x, y=y, z=z';
	}
	if (useCase === 'pde2d') {
		return 'col sep=comma, x=x, y=u';
	}
	return 'col sep=comma, x=x, y=y';
}

export function buildOctavePlotTableCommand(
	spec: GraphSpec,
	useCase: OctaveUseCase,
	tableFile: string,
): OctavePlotTableCommand {
	const styleOpts = plotStyleOptions(spec);
	const tableOpts = tableColumnBindings(useCase);
	const is3d = useCase === 'surface3d' || useCase === 'pde3d' || useCase === 'largeSurface';

	if (is3d) {
		const meshRows = spec.samplesY ?? spec.samples ?? 35;
		const surfOpts = joinOptions([
			'mesh',
			`mesh/rows=${meshRows}`,
			styleOpts,
		]);
		return {
			addplotLine: `\\addplot3[${surfOpts}] table[${tableOpts}] {${tableFile}};`,
			colSepComma: true,
			meshRows,
		};
	}

	const plotOpts = joinOptions([styleOpts, 'thick']);
	return {
		addplotLine: `\\addplot[${plotOpts}] table[${tableOpts}] {${tableFile}};`,
		colSepComma: true,
	};
}

export function buildTikzFromOctaveData(
	spec: GraphSpec,
	data: OctavePipelineResult,
): string {
	const useCase = data.useCase;
	const is3d = useCase === 'surface3d' || useCase === 'pde3d' || useCase === 'largeSurface';
	const axisOpts = axisOptions(spec, is3d);
	const tableFile = data.csvFilename;
	const plot = buildOctavePlotTableCommand(spec, useCase, tableFile);

	return [
		'\\begin{tikzpicture}',
		`\\begin{axis}[${axisOpts}]`,
		spec.equation
			? `% ${spec.equation.replace(/%/g, '')}`
			: '',
		plot.addplotLine,
		'\\end{axis}',
		'\\end{tikzpicture}',
	].filter(Boolean).join('\n');
}

export function isOctave3dCase(useCase: OctaveUseCase): boolean {
	return useCase === 'surface3d' || useCase === 'pde3d' || useCase === 'largeSurface';
}

export function formatOctaveRenderDebugDetails(debug: OctavePipelineResult['debug']): string {
	if (!debug) {
		return '';
	}

	return [
		`Octave script path: ${debug.scriptPath}`,
		'',
		'CSV preview (first 10 lines):',
		debug.csvPreview || '(empty)',
		'',
		'PGFPlots table command:',
		debug.plotTableCommand,
		`col sep=comma: ${debug.colSepComma ? 'yes' : 'no'}`,
	].join('\n');
}
