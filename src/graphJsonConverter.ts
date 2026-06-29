import { expandGraphSyntax } from '../graphPreprocessor';
import { buildTikzFromOctaveData } from '../octave/octaveDataTikz';
import { runOctavePipeline, type OctaveRenderDebug } from '../octave/octavePipeline';
import { shouldUseOctave } from '../octave/octaveRouter';
import { compileExpressionForPgfplots } from '../graphSyntax';
import type { MathGraphSettings } from './settings';
import { resolveLatexGraphDimensions } from './graphSize';
import { getUserFunction, serializeGraphSpec, type GraphSpec } from './graphSpec';

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
	const style = spec.style ?? {};
	const parts: string[] = [];
	if (style.color) {
		parts.push(`color=${style.color}`);
	}
	if (style.width) {
		parts.push(`width=${style.width}`);
	}
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
	if (spec.title) {
		parts.push(`title={${spec.title}}`);
	}
	return joinOptions(parts);
}

function buildAxisSize(spec: GraphSpec, settings?: MathGraphSettings): string {
	const { width, height } = resolveLatexGraphDimensions(spec, settings);
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

function buildPointLines(spec: GraphSpec): string {
	const points = spec.points ?? [];
	return points
		.map(point => {
			const opts = point.label ? `[label={${point.label}}]` : '';
			return `\\point${opts}{${point.x}, ${point.y}}`;
		})
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
	const labels = spec.labels ?? {};
	const { width, height } = resolveLatexGraphDimensions(spec, settings);
	const xDomain = rangeToDomain(spec.ranges?.x);
	const yDomain = rangeToDomain(spec.ranges?.y);

	const axisOpts = joinOptions([
		'grid=both',
		'axis lines=middle',
		'view={45}{30}',
		`width=${width}`,
		`height=${height}`,
		labels.x ? `xlabel={${labels.x}}` : '',
		labels.y ? `ylabel={${labels.y}}` : '',
		labels.z ? `zlabel={${labels.z}}` : '',
		spec.title ? `title={${spec.title}}` : '',
		xDomain ? `xmin=${xDomain.split(':')[0]}` : '',
		xDomain ? `xmax=${xDomain.split(':')[1]}` : '',
		yDomain ? `ymin=${yDomain.split(':')[0]}` : '',
		yDomain ? `ymax=${yDomain.split(':')[1]}` : '',
	]);

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
	const pointLines = buildPointLines(spec);

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

	return [paramLines, axisLine, plotLine, pointLines].filter(Boolean).join('\n');
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
		return buildParametric3dTikz(prepared, buildStyleOptions(prepared), settings);
	}

	const graphSyntax = graphSpecToGraphSyntax(prepared, settings);
	return expandGraphSyntax(graphSyntax);
}

export function graphSpecToFencedBlock(spec: GraphSpec): string {
	return ['```graph', serializeGraphSpec(spec), '```'].join('\n');
}

export function graphSpecToTikzSource(spec: GraphSpec, settings?: MathGraphSettings): string {
	return graphSpecToTikz(spec, settings);
}

export type GraphRenderEngineKind = 'symbolic' | 'octave';

export interface GraphRenderBundle {
	tikz: string;
	assets: Record<string, string>;
	engine: GraphRenderEngineKind;
	octaveDebug?: OctaveRenderDebug;
}

/**
 * Build TikZ for LuaLaTeX. Uses Octave numerical sampling when settings allow;
 * otherwise falls back to symbolic PGFPlots (default).
 */
export async function buildGraphRenderBundle(
	spec: GraphSpec,
	settings: MathGraphSettings,
): Promise<GraphRenderBundle> {
	const prepared = prepareSpecForRender(spec);
	const octaveCase = shouldUseOctave(prepared, settings);

	if (octaveCase) {
		const octaveData = await runOctavePipeline(prepared, octaveCase, settings);
		return {
			tikz: buildTikzFromOctaveData(prepared, octaveData),
			assets: { [octaveData.csvFilename]: octaveData.csvContent },
			engine: 'octave',
			octaveDebug: octaveData.debug,
		};
	}

	return {
		tikz: graphSpecToTikz(prepared, settings),
		assets: {},
		engine: 'symbolic',
	};
}
