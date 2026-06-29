import { normalizePgfMath } from './graphExpression';

export interface ImplicitFallback {
	line: string;
	limits?: { x: { min: number; max: number }; y: { min: number; max: number } };
}

const CIRCLE_PATTERN = /^\(\s*(.+?)\s*\)\s*\^\s*2\s*\+\s*\(\s*(.+?)\s*\)\s*\^\s*2\s*=\s*(.+)$/i;
const SIMPLE_CIRCLE = /^x\s*\^\s*2\s*\+\s*y\s*\^\s*2\s*(?:=\s*|-\s*)(.+)$/i;
const IMPLICIT_CIRCLE_DIFF = /^\(\s*x\s*\^\s*2\s*\+\s*y\s*\^\s*2\s*\)\s*-\s*\(?\s*(.+?)\s*\)?$/i;
const ELLIPSE_PATTERN = /^x\s*\^\s*2\s*\/\s*(.+?)\s*\+\s*y\s*\^\s*2\s*\/\s*(.+?)\s*=\s*1\s*$/i;

function parseNumeric(value: string): number | null {
	const trimmed = value.trim();
	if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
		return null;
	}
	const parsed = Number.parseFloat(trimmed);
	return Number.isFinite(parsed) ? parsed : null;
}

function circleFromRadius(r: number, filled: boolean): ImplicitFallback {
	const pad = r * 1.15;
	return {
		line: filled
			? `\\fill[blue, opacity=0.15] (axis cs:0,0) circle[radius=${r}];\\addplot[domain=0:360, samples=200, trig format plots=deg] ({${r}*cos(x)}, {${r}*sin(x)});`
			: `\\addplot[domain=0:360, samples=200, trig format plots=deg] ({${r}*cos(x)}, {${r}*sin(x)});`,
		limits: { x: { min: -pad, max: pad }, y: { min: -pad, max: pad } },
	};
}

function ellipseFromRadii(a: number, b: number, filled: boolean): ImplicitFallback {
	const padX = a * 1.15;
	const padY = b * 1.15;
	return {
		line: filled
			? `\\fill[blue, opacity=0.15] (axis cs:0,0) ellipse[x radius=${a}, y radius=${b}];\\addplot[domain=0:360, samples=200, trig format plots=deg] ({${a}*cos(x)}, {${b}*sin(x)});`
			: `\\addplot[domain=0:360, samples=200, trig format plots=deg] ({${a}*cos(x)}, {${b}*sin(x)});`,
		limits: { x: { min: -padX, max: padX }, y: { min: -padY, max: padY } },
	};
}

export function tryImplicitFallback(rawExpr: string, filled = false): ImplicitFallback | null {
	const expr = normalizePgfMath(rawExpr.trim());

	const simpleCircle = SIMPLE_CIRCLE.exec(expr);
	if (simpleCircle) {
		const r2 = parseNumeric(simpleCircle[1]);
		if (r2 !== null && r2 >= 0) {
			return circleFromRadius(Math.sqrt(r2), filled);
		}
	}

	const implicitDiff = IMPLICIT_CIRCLE_DIFF.exec(expr);
	if (implicitDiff) {
		const r2 = parseNumeric(implicitDiff[1]);
		if (r2 !== null && r2 >= 0) {
			return circleFromRadius(Math.sqrt(r2), filled);
		}
	}

	const circle = CIRCLE_PATTERN.exec(expr);
	if (circle) {
		const lhsX = circle[1].trim();
		const lhsY = circle[2].trim();
		if (lhsX === 'x' && lhsY === 'y') {
			const r2 = parseNumeric(circle[3]);
			if (r2 !== null && r2 >= 0) {
				return circleFromRadius(Math.sqrt(r2), filled);
			}
		}
	}

	const ellipse = ELLIPSE_PATTERN.exec(expr);
	if (ellipse) {
		const a2 = parseNumeric(ellipse[1]);
		const b2 = parseNumeric(ellipse[2]);
		if (a2 !== null && b2 !== null && a2 > 0 && b2 > 0) {
			return ellipseFromRadii(Math.sqrt(a2), Math.sqrt(b2), filled);
		}
	}

	return null;
}

export function tryInequalityCircleFill(rawExpr: string): ImplicitFallback | null {
	const expr = rawExpr.trim();
	if (!/(<=|>=|<|>)/.test(expr)) {
		return null;
	}

	const normalized = expr
		.replace(/\s*(<=|>=|<|>)\s*/g, ' = ')
		.replace(/=\s*0\s*$/, '')
		.trim();

	const inner = normalized.includes('=')
		? normalized.split('=').map(part => part.trim()).join(' - (') + ')'
		: normalized;

	return tryImplicitFallback(inner.replace(/^\(\s*|\s*\)$/g, ''), true);
}
