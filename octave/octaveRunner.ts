import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { formatExecError, RenderTimeoutError } from '../render/commandResolver';
import {
	buildOctaveEvalArgs,
	spawnOctaveWithTimeout,
} from './octaveProcess';
import { resolveOctave } from './octaveResolver';

const OCTAVE_TIMEOUT_MS = 120_000;
const OCTAVE_TEST_TIMEOUT_MS = 30_000;

export class OctaveEngineError extends Error {
	constructor(message: string, readonly rawLog?: string) {
		super(message);
		this.name = 'OctaveEngineError';
	}
}

export interface OctaveRunResult {
	workDir: string;
	scriptPath: string;
	csvPath: string;
	csvContent: string;
	stdout: string;
	stderr: string;
	exitCode: number;
}

export interface OctaveTestResult {
	ok: boolean;
	path: string;
	stdout: string;
	stderr: string;
	exitCode?: number;
	error?: string;
}

export function formatOctaveDebugLog(details: {
	octavePath: string;
	workDir?: string;
	scriptPath?: string;
	exitCode?: number;
	stdout?: string;
	stderr?: string;
}): string {
	return [
		`Octave CLI path: ${details.octavePath}`,
		details.workDir ? `Working directory: ${details.workDir}` : '',
		details.scriptPath ? `Script path: ${details.scriptPath}` : '',
		details.exitCode !== undefined ? `Exit code: ${details.exitCode}` : '',
		details.stdout ? `\n--- stdout ---\n${details.stdout.trim()}` : '',
		details.stderr ? `\n--- stderr ---\n${details.stderr.trim()}` : '',
	].filter(Boolean).join('\n');
}

export async function testOctaveCli(octavePathSetting: string): Promise<OctaveTestResult> {
	const octavePath = await resolveOctave(octavePathSetting);
	if (!octavePath) {
		return {
			ok: false,
			path: '',
			stdout: '',
			stderr: '',
			error: 'Octave CLI not found.',
		};
	}

	const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mathgraph-octave-test-'));

	try {
		const { stdout, stderr, exitCode } = await spawnOctaveWithTimeout(
			octavePath,
			buildOctaveEvalArgs('disp(2+2);'),
			{ cwd: workDir },
			OCTAVE_TEST_TIMEOUT_MS,
		);

		const ok = stdout.trim().includes('4');
		return { ok, path: octavePath, stdout, stderr, exitCode };
	} catch (err) {
		const execErr = err as Error & { stdout?: string; stderr?: string; code?: number };
		return {
			ok: false,
			path: octavePath,
			stdout: execErr.stdout ?? '',
			stderr: execErr.stderr ?? formatExecError(err),
			exitCode: execErr.code,
			error: formatExecError(err),
		};
	} finally {
		try {
			fs.rmSync(workDir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	}
}

export async function runOctaveScript(
	script: string,
	octavePathSetting: string,
): Promise<OctaveRunResult> {
	const octavePath = await resolveOctave(octavePathSetting);
	if (!octavePath) {
		throw new OctaveEngineError(
			'Octave CLI not found. Install Octave or set the Octave CLI path in Math Plotter settings.',
		);
	}

	if (octavePath.includes('/Applications/Octave.app')) {
		throw new OctaveEngineError(
			'The Octave GUI app path is not supported. Use the headless Octave CLI (octave-cli) instead.',
		);
	}

	const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mathgraph-octave-'));
	const scriptPath = path.join(workDir, 'graph-sample.m');
	const csvPath = path.join(workDir, 'graph-data.csv');

	fs.writeFileSync(scriptPath, script, 'utf8');

	const evalScript = `cd("${workDir.replace(/\\/g, '/')}"); source("graph-sample.m");`;
	const args = buildOctaveEvalArgs(evalScript);

	try {
		const { stdout, stderr, exitCode } = await spawnOctaveWithTimeout(
			octavePath,
			args,
			{ cwd: workDir },
			OCTAVE_TIMEOUT_MS,
		);

		if (!fs.existsSync(csvPath)) {
			throw new OctaveEngineError(
				'Octave failed while sampling the graph. Open debug details for the Octave log.',
				formatOctaveDebugLog({
					octavePath,
					workDir,
					scriptPath,
					exitCode,
					stdout,
					stderr,
				}),
			);
		}

		return {
			workDir,
			scriptPath,
			csvPath,
			csvContent: fs.readFileSync(csvPath, 'utf8'),
			stdout,
			stderr,
			exitCode,
		};
	} catch (err) {
		if (err instanceof OctaveEngineError) {
			throw err;
		}

		const timedOut = err instanceof RenderTimeoutError;
		const execErr = err as Error & { stdout?: string; stderr?: string; code?: number };
		const stdout = execErr.stdout ?? '';
		const stderr = execErr.stderr ?? formatExecError(err);

		throw new OctaveEngineError(
			timedOut
				? 'Octave timed out while sampling the graph. Open debug details for the Octave log.'
				: formatOctaveFailureMessage(stderr || formatExecError(err)),
			formatOctaveDebugLog({
				octavePath,
				workDir,
				scriptPath,
				exitCode: execErr.code,
				stdout,
				stderr,
			}),
		);
	}
}

function formatOctaveFailureMessage(raw: string): string {
	if (/elementwise|Use \.\^|only square matrix arguments are permitted/i.test(raw)) {
		return 'Octave could not evaluate the function. The plugin may have failed to convert the expression to elementwise form.';
	}
	return 'Octave failed while sampling the graph. Open debug details for the Octave log.';
}

export function cleanupOctaveWorkDir(workDir: string): void {
	try {
		fs.rmSync(workDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
}
