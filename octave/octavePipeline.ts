import type { GraphSpec } from '../src/graphSpec';
import type { MathGraphSettings } from '../src/settings';
import { buildOctavePlotTableCommand } from './octaveDataTikz';
import {
	csvColumnsForUseCase,
	csvPreviewLines,
	OctaveCsvValidationError,
	validateOctaveCsv,
} from './octaveCsvValidation';
import { OctaveEngineError } from './octaveRunner';
import { OCTAVE_DATA_FILENAME, generateOctaveScript } from './octaveScriptGenerator';
import { cleanupOctaveWorkDir, runOctaveScript } from './octaveRunner';
import type { OctaveUseCase } from './octaveRouter';

export interface OctaveRenderDebug {
	scriptPath: string;
	csvPreview: string;
	plotTableCommand: string;
	colSepComma: boolean;
}

export interface OctavePipelineResult {
	csvFilename: string;
	csvContent: string;
	useCase: OctaveUseCase;
	script: string;
	debug: OctaveRenderDebug;
}

function buildDebugInfo(
	spec: GraphSpec,
	useCase: OctaveUseCase,
	scriptPath: string,
	csvContent: string,
): OctaveRenderDebug {
	const plot = buildOctavePlotTableCommand(spec, useCase, OCTAVE_DATA_FILENAME);
	return {
		scriptPath,
		csvPreview: csvPreviewLines(csvContent),
		plotTableCommand: plot.addplotLine,
		colSepComma: plot.colSepComma,
	};
}

function formatValidationFailureDebug(
	scriptPath: string,
	csvPreview: string | undefined,
	plotTableCommand: string,
): string {
	return [
		`Octave script path: ${scriptPath}`,
		'',
		'CSV preview (first 10 lines):',
		csvPreview ?? '(empty)',
		'',
		'PGFPlots table command:',
		plotTableCommand,
		'col sep=comma: yes',
	].join('\n');
}

export async function runOctavePipeline(
	spec: GraphSpec,
	useCase: OctaveUseCase,
	settings: MathGraphSettings,
): Promise<OctavePipelineResult> {
	const script = generateOctaveScript(spec, useCase);
	const plotPreview = buildOctavePlotTableCommand(spec, useCase, OCTAVE_DATA_FILENAME);
	const run = await runOctaveScript(script, settings.octavePath);

	try {
		try {
			validateOctaveCsv(run.csvContent, {
				columns: csvColumnsForUseCase(useCase),
			});
		} catch (err) {
			if (err instanceof OctaveCsvValidationError) {
				throw new OctaveEngineError(
					err.message,
					formatValidationFailureDebug(
						run.scriptPath,
						err.csvPreview ?? csvPreviewLines(run.csvContent),
						plotPreview.addplotLine,
					),
				);
			}
			throw err;
		}

		return {
			csvFilename: OCTAVE_DATA_FILENAME,
			csvContent: run.csvContent,
			useCase,
			script,
			debug: buildDebugInfo(spec, useCase, run.scriptPath, run.csvContent),
		};
	} finally {
		cleanupOctaveWorkDir(run.workDir);
	}
}
