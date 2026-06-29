import * as fs from 'fs';
import { execFileWithTimeout } from '../render/commandResolver';

/** Preferred headless Octave CLI paths, checked in order. */
export const OCTAVE_CLI_DETECT_PATHS = [
	'/opt/homebrew/bin/octave-cli',
	'/usr/local/bin/octave-cli',
	'/usr/bin/octave-cli',
	'/opt/homebrew/bin/octave',
	'/usr/local/bin/octave',
	'/usr/bin/octave',
] as const;

export const DEFAULT_OCTAVE_CLI_PATH = '/opt/homebrew/bin/octave-cli';

export async function detectOctaveCli(): Promise<string | null> {
	return resolveOctave('');
}

export async function resolveOctave(customPath: string): Promise<string | null> {
	const trimmed = customPath.trim();
	const candidates = trimmed
		? [trimmed]
		: [...OCTAVE_CLI_DETECT_PATHS, 'octave-cli', 'octave'];

	for (const candidate of candidates) {
		if (candidate.includes('/')) {
			if (fs.existsSync(candidate)) {
				return candidate;
			}
			continue;
		}

		try {
			const { stdout } = await execFileWithTimeout('/usr/bin/which', [candidate], {}, 5_000);
			const resolved = stdout.trim();
			if (resolved && !resolved.includes('/Applications/Octave.app')) {
				return resolved;
			}
		} catch {
			// try next
		}
	}

	return null;
}
