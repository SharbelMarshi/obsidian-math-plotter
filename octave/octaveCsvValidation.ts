export interface OctaveCsvExpectation {
	columns: string[];
	minDataRows?: number;
}

export class OctaveCsvValidationError extends Error {
	constructor(message: string, readonly csvPreview?: string) {
		super(message);
		this.name = 'OctaveCsvValidationError';
	}
}

export function csvColumnsForUseCase(useCase: string): string[] {
	switch (useCase) {
		case 'surface3d':
		case 'pde3d':
		case 'largeSurface':
			return ['x', 'y', 'z'];
		case 'pde2d':
			return ['x', 'u'];
		default:
			return ['x', 'y'];
	}
}

export function validateOctaveCsv(
	content: string,
	expectation: OctaveCsvExpectation,
): void {
	const trimmed = content.trim();
	if (!trimmed) {
		throw new OctaveCsvValidationError(
			'Octave generated invalid graph data. Expected CSV columns '
			+ `${expectation.columns.join(',')}.`,
			'(empty file)',
		);
	}

	const lines = trimmed.split(/\r?\n/).filter(line => line.trim().length > 0);
	const preview = lines.slice(0, 10).join('\n');
	const expectedHeader = expectation.columns.join(',').toLowerCase();
	const actualHeader = lines[0].trim().toLowerCase();

	if (actualHeader !== expectedHeader && !actualHeader.includes(expectedHeader)) {
		throw new OctaveCsvValidationError(
			'Octave generated invalid graph data. Expected CSV columns '
			+ `${expectation.columns.join(',')}.`,
			preview,
		);
	}

	const minRows = expectation.minDataRows ?? 2;
	if (lines.length < minRows + 1) {
		throw new OctaveCsvValidationError(
			'Octave generated invalid graph data. Expected CSV columns '
			+ `${expectation.columns.join(',')}.`,
			preview,
		);
	}

	for (let rowIndex = 1; rowIndex < lines.length; rowIndex++) {
		const row = lines[rowIndex].trim();
		const parts = row.split(',');
		if (parts.length !== expectation.columns.length) {
			throw new OctaveCsvValidationError(
				'Octave generated invalid graph data. Expected CSV columns '
				+ `${expectation.columns.join(',')}.`,
				preview,
			);
		}

		for (const part of parts) {
			const value = Number(part.trim());
			if (!Number.isFinite(value)) {
				throw new OctaveCsvValidationError(
					'Octave generated invalid graph data. Expected CSV columns '
					+ `${expectation.columns.join(',')}.`,
					preview,
				);
			}
		}
	}
}

export function csvPreviewLines(content: string, maxLines = 10): string {
	return content
		.trim()
		.split(/\r?\n/)
		.filter(line => line.trim().length > 0)
		.slice(0, maxLines)
		.join('\n');
}
