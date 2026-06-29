import { evaluatePlotExpr, normalizePgfMath, type NumericRange } from './graphExpression';

export interface AnalysisPoint {
	x: number;
	y: number;
}

function sampleRange(range: NumericRange, samples: number): number[] {
	const values: number[] = [];
	for (let i = 0; i <= samples; i++) {
		const t = i / samples;
		values.push(range.min + t * (range.max - range.min));
	}
	return values;
}

function compileExplicit(expr: string): (x: number) => number | null {
	const normalized = normalizePgfMath(expr);
	return (x: number) => evaluatePlotExpr(normalized, 'x', x, false);
}

export function findRootsNumeric(
	expr: string,
	domain: NumericRange,
	samples = 400,
): AnalysisPoint[] {
	const fn = compileExplicit(expr);
	const xs = sampleRange(domain, samples);
	const roots: AnalysisPoint[] = [];
	let prevX = xs[0];
	let prevY = fn(prevX);

	for (let i = 1; i < xs.length; i++) {
		const x = xs[i];
		const y = fn(x);
		if (y === null || prevY === null) {
			prevX = x;
			prevY = y;
			continue;
		}

		if (Math.abs(y) < 1e-6) {
			roots.push({ x, y: 0 });
		} else if (prevY * y < 0) {
			let lo = prevX;
			let hi = x;
			for (let step = 0; step < 40; step++) {
				const mid = (lo + hi) / 2;
				const midY = fn(mid);
				if (midY === null) {
					break;
				}
				if (Math.abs(midY) < 1e-8 || hi - lo < 1e-6) {
					roots.push({ x: mid, y: 0 });
					break;
				}
				if (prevY * midY <= 0) {
					hi = mid;
				} else {
					lo = mid;
					prevY = midY;
				}
			}
		}

		prevX = x;
		prevY = y;
	}

	return dedupePoints(roots);
}

export function findIntersectionNumeric(
	exprA: string,
	exprB: string,
	domain: NumericRange,
	samples = 400,
): AnalysisPoint[] {
	const fnA = compileExplicit(exprA);
	const fnB = compileExplicit(exprB);
	const xs = sampleRange(domain, samples);
	const points: AnalysisPoint[] = [];
	let prevX = xs[0];
	let prevDiff = diff(fnA(prevX), fnB(prevX));

	for (let i = 1; i < xs.length; i++) {
		const x = xs[i];
		const diffValue = diff(fnA(x), fnB(x));
		if (diffValue === null || prevDiff === null) {
			prevX = x;
			prevDiff = diffValue;
			continue;
		}

		if (Math.abs(diffValue) < 1e-6) {
			const y = fnA(x);
			if (y !== null) {
				points.push({ x, y });
			}
		} else if (prevDiff * diffValue < 0) {
			let lo = prevX;
			let hi = x;
			for (let step = 0; step < 40; step++) {
				const mid = (lo + hi) / 2;
				const midDiff = diff(fnA(mid), fnB(mid));
				if (midDiff === null) {
					break;
				}
				if (Math.abs(midDiff) < 1e-8 || hi - lo < 1e-6) {
					const y = fnA(mid);
					if (y !== null) {
						points.push({ x: mid, y });
					}
					break;
				}
				if (prevDiff * midDiff <= 0) {
					hi = mid;
				} else {
					lo = mid;
					prevDiff = midDiff;
				}
			}
		}

		prevX = x;
		prevDiff = diffValue;
	}

	return dedupePoints(points);
}

function diff(a: number | null, b: number | null): number | null {
	if (a === null || b === null) {
		return null;
	}
	return a - b;
}

function dedupePoints(points: AnalysisPoint[]): AnalysisPoint[] {
	const seen = new Set<string>();
	const result: AnalysisPoint[] = [];
	for (const point of points) {
		const key = `${point.x.toFixed(4)}:${point.y.toFixed(4)}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push({
			x: Number.parseFloat(point.x.toFixed(6)),
			y: Number.parseFloat(point.y.toFixed(6)),
		});
	}
	return result;
}

export function formatAnalysisCoordinates(points: AnalysisPoint[]): string {
	return points.map(point => `(${point.x}, ${point.y})`).join(' ');
}

export function parseIntersectExpressions(body: string): { exprA: string; exprB: string } {
	const trimmed = body.trim();
	if (trimmed.includes(';')) {
		const [exprA, exprB] = trimmed.split(';').map(part => part.trim());
		return { exprA, exprB };
	}

	const commaSplit = trimmed.split(',').map(part => part.trim());
	if (commaSplit.length === 2) {
		return { exprA: commaSplit[0], exprB: commaSplit[1] };
	}

	throw new Error('Intersections need two expressions separated by comma or semicolon.');
}

export function parseRootExpression(body: string): string {
	const trimmed = body.trim();
	const explicitY = /^y\s*=\s*(.+)$/i.exec(trimmed);
	return explicitY ? explicitY[1].trim() : trimmed;
}
