import type { GraphSpec } from '../src/graphSpec';
import { getUserFunction } from '../src/graphSpec';
import { csvColumnsForUseCase } from './octaveCsvValidation';
import { expressionToOctave, rangeBoundToOctave } from './expressionToOctave';
import type { OctaveUseCase } from './octaveRouter';

export const OCTAVE_DATA_FILENAME = 'graph-data.csv';

const OCTAVE_VARIABLES = ['x', 'y', 'z', 't', 'r'];

function octaveContext(spec: GraphSpec): { variables: string[]; parameters: Record<string, string> } {
	const params = spec.parameters ?? {};
	return {
		variables: OCTAVE_VARIABLES,
		// Parameter names are known identifiers; values are assigned separately in the script.
		parameters: Object.fromEntries(Object.keys(params).map(name => [name, ''])),
	};
}

function plotExpression(spec: GraphSpec, useCase: OctaveUseCase): string {
	const fn = getUserFunction(spec) || '0';
	const context = octaveContext(spec);
	switch (useCase) {
		case 'surface3d':
		case 'pde3d':
		case 'largeSurface':
		case 'ode2d':
		case 'pde2d':
		case 'implicit2d':
		case 'function2d':
		default:
			return expressionToOctave(fn, context);
	}
}

function parameterLines(spec: GraphSpec): string {
	const params = spec.parameters ?? {};
	const context = octaveContext(spec);
	return Object.entries(params)
		.map(([name, value]) => `${name} = ${expressionToOctave(value, context)};`)
		.join('\n');
}

function writeCsvWithHeader(columns: string[], dataVariable = 'data'): string[] {
	const header = columns.join(',');
	const format = columns.map(() => '%.12g').join(',');
	return [
		`fid = fopen("${OCTAVE_DATA_FILENAME}", "w");`,
		`fprintf(fid, "${header}\\n");`,
		`fprintf(fid, "${format}\\n", ${dataVariable}.');`,
		'fclose(fid);',
	];
}

export function generateOctaveScript(spec: GraphSpec, useCase: OctaveUseCase): string {
	const expr = plotExpression(spec, useCase);
	const paramBlock = parameterLines(spec);
	const nx = spec.samples ?? 35;
	const ny = spec.samplesY ?? spec.samples ?? 35;
	const xMin = rangeBoundToOctave(spec.ranges?.x?.[0] ?? '', '-5');
	const xMax = rangeBoundToOctave(spec.ranges?.x?.[1] ?? '', '5');
	const yMin = rangeBoundToOctave(spec.ranges?.y?.[0] ?? '', '-5');
	const yMax = rangeBoundToOctave(spec.ranges?.y?.[1] ?? '', '5');
	const csvColumns = csvColumnsForUseCase(useCase);

	const header = [
		'# Math Plotter — generated Octave script',
		'warning("off", "all");',
		paramBlock,
	].filter(Boolean).join('\n');

	if (useCase === 'surface3d' || useCase === 'pde3d' || useCase === 'largeSurface') {
		return [
			header,
			`xmin = ${xMin}; xmax = ${xMax};`,
			`ymin = ${yMin}; ymax = ${yMax};`,
			`nx = ${nx}; ny = ${ny};`,
			'[X, Y] = meshgrid(linspace(xmin, xmax, nx), linspace(ymin, ymax, ny));',
			'x = X;',
			'y = Y;',
			`Z = ${expr};`,
			'data = [X(:), Y(:), Z(:)];',
			...writeCsvWithHeader(csvColumns),
		].join('\n');
	}

	if (useCase === 'implicit2d') {
		return [
			header,
			`xmin = ${xMin}; xmax = ${xMax};`,
			`ymin = ${yMin}; ymax = ${yMax};`,
			`nx = ${nx}; ny = ${ny};`,
			'[X, Y] = meshgrid(linspace(xmin, xmax, nx), linspace(ymin, ymax, ny));',
			'x = X;',
			'y = Y;',
			`Z = ${expr};`,
			'[c, h] = contour(X, Y, Z, [0 0]);',
			'delete(h);',
			'xc = c(1, 2:c(2, 1));',
			'yc = c(2, 2:c(2, 1));',
			'data = [xc(:), yc(:)];',
			...writeCsvWithHeader(csvColumns),
		].join('\n');
	}

	// 2D curves: function2d, ode2d, pde2d
	const n = spec.samples ?? 100;
	const yBody = expr.replace(/^y\s*=\s*/i, '');

	if (useCase === 'pde2d') {
		const sliced = expr.replace(/\by\b/g, '((ymin + ymax) / 2)');
		return [
			header,
			`xmin = ${xMin}; xmax = ${xMax};`,
			`ymin = ${yMin}; ymax = ${yMax};`,
			`n = ${n};`,
			'x = linspace(xmin, xmax, n);',
			`u = ${sliced};`,
			'data = [x(:), u(:)];',
			...writeCsvWithHeader(csvColumns),
		].join('\n');
	}

	return [
		header,
		`xmin = ${xMin}; xmax = ${xMax};`,
		`n = ${n};`,
		'x = linspace(xmin, xmax, n);',
		`y = ${yBody};`,
		'data = [x(:), y(:)];',
		...writeCsvWithHeader(csvColumns),
	].join('\n');
}
