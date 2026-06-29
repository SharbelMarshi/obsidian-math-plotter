import { spawn } from 'child_process';
import { RenderTimeoutError } from '../render/commandResolver';

export const OCTAVE_HEADLESS_FLAGS = [
	'--quiet',
	'--no-gui',
	'--no-window-system',
	'--no-history',
] as const;

export interface OctaveSpawnResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export function buildOctaveProcessEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		OCTAVE_HISTFILE: process.platform === 'win32' ? 'NUL' : '/dev/null',
		GNUTERM: 'dumb',
	};
	if (process.platform !== 'win32') {
		env.DISPLAY = '';
	}
	return env;
}

export function spawnOctaveWithTimeout(
	octavePath: string,
	args: string[],
	options: { cwd?: string },
	timeoutMs: number,
): Promise<OctaveSpawnResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(octavePath, args, {
			cwd: options.cwd,
			env: buildOctaveProcessEnv(),
			windowsHide: true,
			detached: false,
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let stdout = '';
		let stderr = '';
		let timedOut = false;

		child.stdout?.on('data', (chunk: Buffer | string) => {
			stdout += chunk.toString();
		});
		child.stderr?.on('data', (chunk: Buffer | string) => {
			stderr += chunk.toString();
		});

		const timer = setTimeout(() => {
			timedOut = true;
			child.kill('SIGKILL');
			reject(new RenderTimeoutError(timeoutMs));
		}, timeoutMs);

		child.on('error', err => {
			clearTimeout(timer);
			if (!timedOut) {
				reject(err);
			}
		});

		child.on('close', code => {
			clearTimeout(timer);
			if (timedOut) {
				return;
			}

			const exitCode = code ?? 1;
			if (exitCode !== 0) {
				const err = new Error(`Octave exited with code ${exitCode}`) as Error & {
					stdout?: string;
					stderr?: string;
					code?: number;
				};
				err.stdout = stdout;
				err.stderr = stderr;
				err.code = exitCode;
				reject(err);
				return;
			}

			resolve({ stdout, stderr, exitCode });
		});
	});
}

export function buildOctaveEvalArgs(evalScript: string): string[] {
	return [...OCTAVE_HEADLESS_FLAGS, '--eval', evalScript];
}
