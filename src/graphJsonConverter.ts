import { expandGraphSyntax } from '../graphPreprocessor';
import { buildTikzFromOctaveData } from '../octave/octaveDataTikz';
import { runOctavePipeline, type OctaveRenderDebug } from '../octave/octavePipeline';
import { shouldUseOctave } from '../octave/octaveRouter';
import { runJsSamplingPipeline } from '../sampler/jsSamplingPipeline';
import { shouldUseJsSampling } from '../sampler/samplingRouter';
import { compileExpressionForPgfplots } from '../graphSyntax';
import { applyGridStyleToTikz } from './graphGridStyle';
import { appendGraphPointsToTikz } from './graphPointsTikz';
import type { MathGraphSettings } from './settings';
import { effectiveSamples2D, effectiveSamples3D } from '../render/renderSampleDefaults';
import type { RenderMode } from '../render/renderMode';
import { isGraph3dView, resolveLatexGraphDimensions } from './graphSize';
import { getUserFunction, serializeGraphSpec, type GraphSpec } from './graphSpec';
import { hydrateGraphStyle, resolvePlotStrokeColor } from './graphPlotStyle';
import { pgfplots3dAxisOptions } from './pgfplots3dAxisStyle';

function rangeToDomain(range?: [string, string]): string | undefined {
	if (!range || range.length !== 2) {
		return undefined;
	}
	return `${range[0].trim()}:${range[1].trim()}`;
}

function joinOptions(options: string[]): string {
	return options.filter(Boolean).join(', ');
}

/** PGFPlots parametric plots use x as the domain variable, not t. */
function mapParametricVariable(text: string, paramName: string): string {
	if (!paramName || paramName === 'x') {
		return text;
	}
	const escaped = paramName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const pattern = new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, 'g');
	return text.replace(pattern, 'x');
}

function prepareSpecForRender(spec: GraphSpec): GraphSpec {
	const prepared: GraphSpec = { ...spec, parameters: { ...(spec.parameters ?? {}) } };

	const paramVar = prepared.parameter ?? 't';
	if (prepared.type === 'parametric2d' || prepared.type === 'parametric3d') {
		if (prepared.xExpression) {
			prepared.xExpression = mapParametricVariable(prepared.xExpression, paramVar);
		}
		if (prepared.yExpression) {
			prepared.yExpression = mapParametricVariable(prepared.yExpression, paramVar);
		}
		if (prepared.zExpression) {
			prepared.zExpression = mapParametricVariable(prepared.zExpression, paramVar);
		}
	}

	return prepared;
}

function buildStyleOptions(spec: GraphSpec): string {
	hydrateGraphStyle(spec);
	const style = spec.style ?? {};
	const parts: string[] = [
		resolvePlotStrokeColor(spec),
		style.width ?? 'thick',
	];
	if (style.fill && style.fill !== 'none') {
		parts.push(`fill=${style.fill}`);
	}
	if (style.opacity !== undefined) {
		parts.push(`opacity=${style.opacity}`);
	}
	if (style.legend) {
		parts.push(`label={${style.legend}}`);
	}
	return joinOptions(parts);
}

function buildAxisBracketOptions(spec: GraphSpec): string {
	const labels = spec.labels ?? {};
	const parts: string[] = [];
	if (labels.x) {
		parts.push(`xlabel={${labels.x}}`);
	}
	if (labels.y) {
		parts.push(`ylabel={${labels.y}}`);
	}
	if (labels.z) {
		parts.push(`zlabel={${labels.z}}`);
	}
	if (spec.title?.trim()) {
		parts.push(`title={${spec.title.trim()}}`);
	}
	return joinOptions(parts);
}

function buildAxisSize(spec: GraphSpec, settings?: MathGraphSettings): string {
	const { width, height } = resolveLatexGraphDimensions(spec);
	const xDomain = rangeToDomain(spec.ranges?.x);
	const yDomain = rangeToDomain(spec.ranges?.y);
	const parts = [width, height];
	if (xDomain && yDomain) {
		parts.push(xDomain, yDomain);
	}
	return parts.join(', ');
}

function buildParameterLines(spec: GraphSpec): string {
	const params = spec.parameters ?? {};
	return Object.entries(params)
		.map(([name, value]) => `\\param{${name}}{${value}}`)
		.join('\n');
}

function buildDataPlot(spec: GraphSpec, styleOpts: string): string {
	const data = spec.data ?? spec.points?.map(p => ({ x: p.x, y: p.y })) ?? [];
	if (data.length === 0) {
		throw new Error('Data plot requires at least one point.');
	}
	const coords = data.map(row => `(${row.x}, ${row.y})`).join(', ');
	return styleOpts ? `\\points[${styleOpts}]{${coords}}` : `\\points{${coords}}`;
}

function buildFunction2d(spec: GraphSpec, styleOpts: string): string {
	const expr = getUserFunction(spec);
	if (!expr) {
		throw new Error('2D function requires an expression.');
	}
	const body = /^y\s*=/i.test(expr) ? expr : `y = ${expr}`;
	const domain = rangeToDomain(spec.ranges?.x);
	const plotOpts = joinOptions([
		domain ? `domain=${domain}` : '',
		spec.samples ? `samples=${spec.samples}` : '',
		styleOpts,
	]);
	return `\\function[${plotOpts}]{${body}}`;
}

function buildSurface3d(spec: GraphSpec, styleOpts: string): string {
	const expr = getUserFunction(spec);
	if (!expr) {
		throw new Error('3D surface requires an expression.');
	}
	const xDomain = rangeToDomain(spec.ranges?.x);
	const yDomain = rangeToDomain(spec.ranges?.y);
	const plotOpts = joinOptions([
		'3d',
		'pde',
		xDomain ? `domain=${xDomain}` : '',
		yDomain ? `y domain=${yDomain}` : '',
		spec.samples ? `samples=${spec.samples}` : '',
		spec.samplesY ? `samples y=${spec.samplesY}` : '',
		styleOpts,
	]);
	return `\\function[${plotOpts}]{${expr}}`;
}

function buildParametric2d(spec: GraphSpec, styleOpts: string): string {
	const xExpr = spec.xExpression?.trim();
	const yExpr = spec.yExpression?.trim();
	if (!xExpr || !yExpr) {
		throw new Error('Parametric 2D requires x and y expressions.');
	}
	const tDomain = rangeToDomain(spec.ranges?.t);
	const plotOpts = joinOptions([
		'parametric',
		tDomain ? `domain=${tDomain}` : '',
		spec.samples ? `samples=${spec.samples}` : '',
		styleOpts,
	]);
	return `\\function[${plotOpts}]{${xExpr}; ${yExpr}}`;
}

function buildExplicitSolutionPlot(spec: GraphSpec, styleOpts: string): string {
	const solution = getUserFunction(spec);
	if (!solution) {
		throw new Error('Plot requires an explicit solution.');
	}

	const view = spec.view ?? (spec.type === 'pde' ? '3d' : '2d');
	if (view === '3d') {
		return buildSurface3d(spec, styleOpts);
	}

	const body = /^y\s*=/i.test(solution) ? solution : solution;
	const xDomain = rangeToDomain(spec.ranges?.x);
	const plotOpts = joinOptions([
		xDomain ? `domain=${xDomain}` : '',
		spec.samples ? `samples=${spec.samples}` : '',
		styleOpts,
	]);
	return `\\function[${plotOpts}]{${body}}`;
}

function buildParametric3dTikz(spec: GraphSpec, styleOpts: string, settings?: MathGraphSettings): string {
	const xExpr = spec.xExpression?.trim();
	const yExpr = spec.yExpression?.trim();
	const zExpr = spec.zExpression?.trim();
	if (!xExpr || !yExpr || !zExpr) {
		throw new Error('Parametric 3D requires x, y, and z expressions.');
	}

	const tDomain = rangeToDomain(spec.ranges?.t) ?? '0:6.28318';

	const axisOpts = pgfplots3dAxisOptions(spec);

	const plotOpts = joinOptions([
		styleOpts,
		`domain=${tDomain}`,
		spec.samples ? `samples=${spec.samples}` : 'samples=100',
	]);

	const xPlot = compileExpressionForPgfplots(xExpr, {
		variables: ['x', 'y', 'z', 't'],
		parameters: spec.parameters ?? {},
	});
	const yPlot = compileExpressionForPgfplots(yExpr, {
		variables: ['x', 'y', 'z', 't'],
		parameters: spec.parameters ?? {},
	});
	const zPlot = compileExpressionForPgfplots(zExpr, {
		variables: ['x', 'y', 'z', 't'],
		parameters: spec.parameters ?? {},
	});

	return [
		'\\begin{tikzpicture}',
		`\\begin{axis}[${axisOpts}]`,
		`\\addplot3[${plotOpts}] ({${xPlot}}, {${yPlot}}, {${zPlot}});`,
		'\\end{axis}',
		'\\end{tikzpicture}',
	].join('\n');
}

function buildGraphBlockBody(spec: GraphSpec, settings?: MathGraphSettings): string {
	const styleOpts = buildStyleOptions(spec);
	const axisBracket = buildAxisBracketOptions(spec);
	const axisSize = buildAxisSize(spec, settings);
	const paramLines = buildParameterLines(spec);

	let plotLine: string;
	switch (spec.type) {
		case 'function2d':
			plotLine = buildFunction2d(spec, styleOpts);
			break;
		case 'surface3d':
			plotLine = buildSurface3d(spec, styleOpts);
			break;
		case 'parametric2d':
			plotLine = buildParametric2d(spec, styleOpts);
			break;
		case 'ode':
		case 'pde':
			plotLine = buildExplicitSolutionPlot(spec, styleOpts);
			break;
		case 'data':
			plotLine = buildDataPlot(spec, styleOpts);
			break;
		case 'parametric3d':
			throw new Error('parametric3d-uses-direct-tikz');
		default:
			throw new Error(`Unsupported graph type: ${String(spec.type)}`);
	}

	const axisLine = axisBracket
		? `\\axis[${axisBracket}]{${axisSize}}`
		: `\\axis{${axisSize}}`;

	return [paramLines, axisLine, plotLine].filter(Boolean).join('\n');
}

export function graphSpecToGraphSyntax(spec: GraphSpec, settings?: MathGraphSettings): string {
	if (spec.type === 'parametric3d') {
		throw new Error('parametric3d-uses-direct-tikz');
	}
	return [
		'\\begin{graph}',
		buildGraphBlockBody(spec, settings),
		'\\end{graph}',
	].join('\n');
}

export function graphSpecToTikz(spec: GraphSpec, settings?: MathGraphSettings): string {
	const prepared = prepareSpecForRender(spec);

	if (prepared.type === 'parametric3d') {
		return appendGraphPointsToTikz(
			buildParametric3dTikz(prepared, buildStyleOptions(prepared), settings),
			prepared,
		);
	}

	const graphSyntax = graphSpecToGraphSyntax(prepared, settings);
	return applyGridStyleToTikz(
		appendGraphPointsToTikz(expandGraphSyntax(graphSyntax), prepared),
		prepared,
	);
}

export function graphSpecToFencedBlock(spec: GraphSpec): string {
	return ['```graph', serializeGraphSpec(spec), '```'].join('\n');
}

export function graphSpecToTikzSource(spec: GraphSpec, settings?: MathGraphSettings): string {
	return graphSpecToTikz(spec, settings);
}

export type GraphRenderEngineKind = 'symbolic' | 'octave' | 'numerical';

export interface GraphRenderBundle {
	tikz: string;
	assets: Record<string, string>;
	engine: GraphRenderEngineKind;
	octaveDebug?: OctaveRenderDebug;
}

export interface GraphRenderBundleOptions {
	renderMode?: RenderMode;
}

function withRenderModeSamples(spec: GraphSpec, renderMode: RenderMode): GraphSpec {
	if (renderMode === 'svgFast') {
		return spec;
	}
	const copy = structuredClone(spec);
	if (isGraph3dView(copy)) {
		const { samplesX, samplesY } = effectiveSamples3D(copy, renderMode);
		copy.samples = samplesX;
		copy.samplesY = samplesY;
	} else {
		copy.samples = effectiveSamples2D(copy, renderMode);
	}
	return copy;
}

/**
 * Build TikZ for high-quality rendering (TikZJax / LuaLaTeX).
 */
export async function buildGraphRenderBundle(
	spec: GraphSpec,
	settings: MathGraphSettings,
	options: GraphRenderBundleOptions = {},
): Promise<GraphRenderBundle> {
	const renderMode = options.renderMode ?? 'tikzjax';
	const prepared = withRenderModeSamples(prepareSpecForRender(spec), renderMode);
	const octaveCase = shouldUseOctave(prepared, settings);

	if (octaveCase) {
		const octaveData = await runOctavePipeline(prepared, octaveCase, settings);
		return {
			tikz: applyGridStyleToTikz(
				appendGraphPointsToTikz(buildTikzFromOctaveData(prepared, octaveData), prepared),
				prepared,
			),
			assets: { [octaveData.csvFilename]: octaveData.csvContent },
			engine: 'octave',
			octaveDebug: octaveData.debug,
		};
	}

	const jsCase = shouldUseJsSampling(prepared);
	if (jsCase) {
		const jsData = runJsSamplingPipeline(prepared, jsCase);
		return {
			tikz: applyGridStyleToTikz(
				appendGraphPointsToTikz(buildTikzFromOctaveData(prepared, jsData), prepared),
				prepared,
			),
			assets: { [jsData.csvFilename]: jsData.csvContent },
			engine: 'numerical',
		};
	}

	return {
		tikz: graphSpecToTikz(prepared, settings),
		assets: {},
		engine: 'symbolic',
	};
}
