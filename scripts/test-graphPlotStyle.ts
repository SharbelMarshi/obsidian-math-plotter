import {
	buildSampled3dPlotOptions,
	graphUsesColoredSurfaceDefault,
	heatColorFromUnit,
	hydrateGraphStyle,
	isAutoGraphColor,
	resolvePlotStrokeColor,
	resolveSurfaceStyle,
} from '../src/graphPlotStyle';
import type { GraphSpec } from '../src/graphSpec';

let failed = 0;

function assert(condition: boolean, message: string): void {
	if (!condition) {
		failed++;
		console.error(`FAIL: ${message}`);
	}
}

const function2d: GraphSpec = { version: 1, type: 'function2d' };
const surface3d: GraphSpec = { version: 1, type: 'surface3d' };
const pde3d: GraphSpec = { version: 1, type: 'pde', view: '3d' };
const pde2d: GraphSpec = { version: 1, type: 'pde', view: '2d' };
const ode2d: GraphSpec = { version: 1, type: 'ode', view: '2d' };

assert(graphUsesColoredSurfaceDefault(surface3d), 'surface3d uses colored default');
assert(graphUsesColoredSurfaceDefault(pde3d), 'pde 3d uses colored default');
assert(!graphUsesColoredSurfaceDefault(function2d), '2d function does not use colored default');

hydrateGraphStyle(function2d);
assert(function2d.style?.color === 'auto', '2D defaults to auto');
assert(function2d.style?.surfaceStyle === 'wireframe', '2D surfaceStyle wireframe');

hydrateGraphStyle(surface3d);
assert(surface3d.style?.surfaceStyle === 'colored', '3D defaults to colored');
assert(surface3d.style?.colormap === 'heat', '3D defaults to heat colormap');

hydrateGraphStyle(pde2d);
assert(pde2d.style?.color === 'auto', 'PDE 2D slice defaults to auto');

assert(isAutoGraphColor('auto'), 'auto is auto color');
assert(isAutoGraphColor('black'), 'legacy black is auto color');
assert(isAutoGraphColor(''), 'empty is auto color');
assert(!isAutoGraphColor('red'), 'red is explicit color');

assert(resolvePlotStrokeColor({ version: 1, type: 'function2d', style: { color: 'auto' } }) === 'mathgraphLine', 'auto resolves to mathgraphLine');
assert(resolvePlotStrokeColor({ version: 1, type: 'function2d', style: { color: 'red' } }) === 'red', 'explicit red preserved');

const legacy3d: GraphSpec = { version: 1, type: 'surface3d', style: { surfaceStyle: 'wireframe' } };
hydrateGraphStyle(legacy3d);
assert(legacy3d.style?.surfaceStyle === 'wireframe', 'explicit wireframe is preserved');

const coloredPlot = buildSampled3dPlotOptions({ version: 1, type: 'surface3d', style: { surfaceStyle: 'colored', colormap: 'heat' } });
assert(coloredPlot.includes('colormap/heat'), 'colored 3D plot uses heat colormap');
assert(coloredPlot.includes('point meta=z'), 'colored 3D plot uses point meta=z');
assert(!coloredPlot.includes('mathgraphLine'), 'colored 3D plot does not force line color');

const wirePlot = buildSampled3dPlotOptions({ version: 1, type: 'surface3d', style: { surfaceStyle: 'wireframe', color: 'auto' } });
assert(wirePlot.includes('draw=mathgraphLine'), 'wireframe 3D auto plot uses mathgraphLine draw');

const wireExplicit = buildSampled3dPlotOptions({ version: 1, type: 'surface3d', style: { surfaceStyle: 'wireframe', color: 'red' } });
assert(wireExplicit.includes('draw=red'), 'wireframe 3D explicit red preserved');

assert(heatColorFromUnit(0).startsWith('rgb('), 'heat color low');
assert(heatColorFromUnit(1).includes('rgb('), 'heat color high');

if (failed === 0) {
	console.log('All graph plot style tests passed.');
} else {
	process.exit(1);
}
