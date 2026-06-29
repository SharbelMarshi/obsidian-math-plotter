import {
	ExpressionEvaluationError,
	formatSampleCsv,
	sampleFunction2D,
	samplePde2D,
	sampleSurface3D,
} from '../src/ExpressionEngine';
import { parseBoundToNumber } from '../src/graphRangeValidation';
import { getUserFunction, type GraphSpec } from '../src/graphSpec';
import { csvColumnsForUseCase, validateOctaveCsv } from '../octave/octaveCsvValidation';
import { OCTAVE_DATA_FILENAME } from '../octave/octaveScriptGenerator';
import type { JsSamplingUseCase } from './samplingRouter';

export class JsSamplingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'JsSamplingError';
	}
}

export interface JsSamplingPipelineResult {
	csvContent: string;
	csvFilename: string;
	useCase: JsSamplingUseCase;
}

function boundOrDefault(raw: string | undefined, fallback: number): number {
	return parseBoundToNumber(raw ?? '') ?? fallback;
}

function generateCsv(spec: GraphSpec, useCase: JsSamplingUseCase): string {
	const expression = getUserFunction(spec);
	if (!expression.trim()) {
		throw new JsSamplingError('Graph requires an expression to sample.');
	}

	const parameters = spec.parameters ?? {};
	const xMin = boundOrDefault(spec.ranges?.x?.[0], -5);
	const xMax = boundOrDefault(spec.ranges?.x?.[1], 5);
	const yMin = boundOrDefault(spec.ranges?.y?.[0], -5);
	const yMax = boundOrDefault(spec.ranges?.y?.[1], 5);
	const samples = spec.samples ?? 100;
	const samplesY = spec.samplesY ?? spec.samples ?? 35;

	try {
		switch (useCase) {
			case 'function2d':
			case 'ode2d': {
				const points = sampleFunction2D(expression, xMin, xMax, samples, parameters);
				return formatSampleCsv(['x', 'y'], points);
			}
			case 'surface3d':
			case 'pde3d': {
				const points = sampleSurface3D(
					expression,
					xMin,
					xMax,
					yMin,
					yMax,
					samples,
					samplesY,
					parameters,
				);
				return formatSampleCsv(['x', 'y', 'z'], points);
			}
			case 'pde2d': {
				const points = samplePde2D(expression, xMin, xMax, yMin, yMax, samples, parameters);
				return formatSampleCsv(['x', 'u'], points);
			}
			default:
				throw new JsSamplingError(`Unsupported sampling case: ${String(useCase)}`);
		}
	} catch (err) {
		if (err instanceof ExpressionEvaluationError) {
			throw new JsSamplingError(err.message);
		}
		throw err;
	}
}

export function runJsSamplingPipeline(
	spec: GraphSpec,
	useCase: JsSamplingUseCase,
): JsSamplingPipelineResult {
	const csvContent = generateCsv(spec, useCase);
	const columns = csvColumnsForUseCase(useCase);
	validateOctaveCsv(csvContent, { columns });

	return {
		csvContent,
		csvFilename: OCTAVE_DATA_FILENAME,
		useCase,
	};
}
