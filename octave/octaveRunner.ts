import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileWithTimeout, formatExecError, RenderTimeoutError } from '../render/commandResolver';
import { resolveOctave } from './octaveResolver';

const OCTAVE_TIMEOUT_MS = 120_000;

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
}

export async function runOctaveScript(
	script: string,
	octavePathSetting: string,
): Promise<OctaveRunResult> {
	const octavePath = await resolveOctave(octavePathSetting);
	if (!octavePath) {
		throw new OctaveEngineError(
			'Octave not found. Install Octave or set the Octave path in MathGraph Studio settings.',
		);
	}

	const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mathgraph-octave-'));
	const scriptPath = path.join(workDir, 'graph-sample.m');
	const csvPath = path.join(workDir, 'graph-data.csv');

	fs.writeFileSync(scriptPath, script, 'utf8');

	try {
		const { stdout, stderr } = await execFileWithTimeout(
			octavePath,
			['--quiet', '--no-gui', '--eval', `cd("${workDir.replace(/\\/g, '/')}"); source("graph-sample.m");`],
			{ cwd: workDir, maxBuffer: 20 * 1024 * 1024 },
			OCTAVE_TIMEOUT_MS,
		);

		if (!fs.existsSync(csvPath)) {
			throw new OctaveEngineError(
				'Octave did not produce graph-data.csv.',
				[stdout, stderr].filter(Boolean).join('\n'),
			);
		}

		return {
			workDir,
			scriptPath,
			csvPath,
			csvContent: fs.readFileSync(csvPath, 'utf8'),
			stdout,
			stderr,
		};
	} catch (err) {
		if (err instanceof OctaveEngineError) {
			throw err;
		}
		const timedOut = err instanceof RenderTimeoutError;
		const raw = formatExecError(err);
		throw new OctaveEngineError(
			timedOut
				? 'Octave timed out.'
				: formatOctaveFailureMessage(raw),
			raw,
		);
	}
}

function formatOctaveFailureMessage(raw: string): string {
	if (/elementwise|Use \.\^|only square matrix arguments are permitted/i.test(raw)) {
		return 'Octave could not evaluate the function. The plugin may have failed to convert the expression to elementwise form.';
	}
	return `Octave failed: ${raw}`;
}

export function cleanupOctaveWorkDir(workDir: string): void {
	try {
		fs.rmSync(workDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
}
