/** Plain-text axis tick labels — ASCII hyphen-minus only (no TeX/Unicode minus). */
export const TICK_LABEL_FONT = 'var(--font-text), sans-serif';

export function formatTickLabel(value: number): string {
	if (Math.abs(value) < 1e-12) {
		return '0';
	}
	const rounded = Number(value.toFixed(10));
	return rounded < 0 ? `-${Math.abs(rounded)}` : `${rounded}`;
}
