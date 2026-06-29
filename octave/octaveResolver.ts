import * as fs from 'fs';
import { execFileWithTimeout } from '../render/commandResolver';

export async function resolveOctave(customPath: string): Promise<string | null> {
	const candidates = customPath.trim()
		? [customPath.trim()]
		: [
			'/opt/homebrew/bin/octave-cli',
			'/usr/local/bin/octave-cli',
			'/Applications/Octave.app/Contents/Resources/usr/bin/octave-cli',
			'/opt/homebrew/bin/octave',
			'/usr/local/bin/octave',
			'octave-cli',
			'octave',
		];

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
			if (resolved) {
				return resolved;
			}
		} catch {
			// try next
		}
	}

	return null;
}
