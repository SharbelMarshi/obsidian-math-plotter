/**
 * Converts user-friendly math syntax into PGFPlots-compatible expressions.
 *
 * Trigonometry: user input is in radians; PGF math uses degrees, so sin(x) → sin(deg(x)).
 * Inverse trig: PGF returns degrees, so asin(x) → rad(asin(x)) to stay in radians.
 * Logarithm: log(x) is treated as the natural logarithm and becomes ln(x).
 */
import { evaluateSafeMathExpression } from './src/safeMathEvaluator';

export const INVALID_SYNTAX_MESSAGE =
	'Invalid function syntax. Use simple syntax such as sin^2(x), x^2, exp(-x), or sqrt(x^2+y^2).';

export class GraphExpressionSyntaxError extends Error {
	constructor(message: string = INVALID_SYNTAX_MESSAGE) {
		super(message);
		this.name = 'GraphExpressionSyntaxError';
	}
}

export interface GraphExpressionContext {
	variables?: string[];
	parameters?: Record<string, string>;
}

export interface FrontendMathNormalizeOptions {
	parameters?: Record<string, string>;
	substituteParameters?: boolean;
}

interface ParsedMathBody {
	content: string;
	end: number;
}

const TRIG_FUNCTIONS = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cosec', 'cot']);
const INVERSE_TRIG_FUNCTIONS = new Set(['asin', 'acos', 'atan', 'arcsin', 'arccos', 'arctan']);
const HYPERBOLIC_FUNCTIONS = new Set(['sinh', 'cosh', 'tanh']);
const INVERSE_HYPERBOLIC_FUNCTIONS = new Set(['asinh', 'acosh', 'atanh']);
const SINGLE_ARG_FUNCTIONS = new Set(['floor', 'ceil', 'round', 'sign', 'log10', 'log2', 'factorial']);
const TWO_ARG_FUNCTIONS = new Set(['mod', 'atan2', 'pow']);
const VARIADIC_FUNCTIONS = new Set(['min', 'max']);

const KNOWN_FUNCTIONS = new Set<string>([
	...TRIG_FUNCTIONS,
	...INVERSE_TRIG_FUNCTIONS,
	...HYPERBOLIC_FUNCTIONS,
	...INVERSE_HYPERBOLIC_FUNCTIONS,
	...SINGLE_ARG_FUNCTIONS,
	...TWO_ARG_FUNCTIONS,
	...VARIADIC_FUNCTIONS,
	'exp', 'ln', 'log', 'sqrt', 'abs', 'deg',
]);

const KNOWN_FUNCTIONS_BY_LENGTH = [...KNOWN_FUNCTIONS].sort((a, b) => b.length - a.length);

const GREEK_LETTER_COMMANDS = [
	'varepsilon', 'vartheta', 'varphi', 'upsilon', 'Upsilon', 'epsilon', 'omicron',
	'lambda', 'Lambda', 'alpha', 'gamma', 'Gamma', 'delta', 'Delta', 'theta', 'Theta',
	'kappa', 'sigma', 'Sigma', 'omega', 'Omega', 'beta', 'zeta', 'iota', 'eta',
	'rho', 'tau', 'chi', 'psi', 'Psi', 'phi', 'Phi', 'xi', 'Xi', 'mu', 'nu',
];

const UNICODE_GREEK: Record<string, string> = {
	'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon', 'ζ': 'zeta',
	'η': 'eta', 'θ': 'theta', 'ϑ': 'theta', 'ι': 'iota', 'κ': 'kappa', 'λ': 'lambda',
	'μ': 'mu', 'ν': 'nu', 'ξ': 'xi', 'ρ': 'rho', 'σ': 'sigma', 'τ': 'tau',
	'υ': 'upsilon', 'φ': 'phi', 'ϕ': 'phi', 'χ': 'chi', 'ψ': 'psi', 'ω': 'omega',
	'Γ': 'Gamma', 'Δ': 'Delta', 'Θ': 'Theta', 'Λ': 'Lambda', 'Ξ': 'Xi',
	'Σ': 'Sigma', 'Φ': 'Phi', 'Ψ': 'Psi', 'Ω': 'Omega',
};

const UNICODE_SUPERSCRIPTS: Record<string, string> = {
	'⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
	'⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-',
};

const DEFAULT_VARIABLES = ['x', 'y', 'z', 't', 'r'];

export type CompileTarget = 'pgfplots' | 'octave';

function wrapTrigArgument(argument: string): string {
	const trimmed = argument.trim();
	if (/^deg\s*\(/i.test(trimmed)) {
		return trimmed;
	}
	return `deg(${trimmed})`;
}

enum TokenType {
	Number,
	Identifier,
	Plus,
	Minus,
	Star,
	Slash,
	Caret,
	LParen,
	RParen,
	Comma,
	Bang,
	Eof,
}

interface Token {
	type: TokenType;
	value: string;
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findMatchingGroup(
	source: string,
	start: number,
	openChar: string,
	closeChar: string,
): { content: string; end: number } | null {
	if (source[start] !== openChar) {
		return null;
	}

	let depth = 0;
	for (let i = start; i < source.length; i++) {
		const char = source[i];
		if (char === openChar) {
			depth++;
		} else if (char === closeChar) {
			depth--;
			if (depth === 0) {
				return {
					content: source.slice(start + 1, i),
					end: i + 1,
				};
			}
		}
	}

	return null;
}

function normalizeFiniteLoopBound(
	raw: string,
	parameters: Record<string, string>,
	command: string,
): number {
	const prepared = stripLatexMathCommands(substituteParameterValues(raw.trim(), parameters), parameters);
	const value = evaluateSafeMathExpression(prepared, {}, []);
	if (!Number.isFinite(value) || !Number.isInteger(value)) {
		throw new GraphExpressionSyntaxError(`${command} bounds must evaluate to finite integers.`);
	}
	return value;
}

function substituteLoopVariable(expr: string, name: string, value: number): string {
	const pattern = new RegExp(`(?<![A-Za-z0-9_])${escapeRegex(name)}(?![A-Za-z0-9_])`, 'g');
	return expr.replace(pattern, `(${value})`);
}

/** Expand finite \sum and \prod commands into explicit +/* chains. */
function expandFiniteLatexLoops(
	expr: string,
	parameters: Record<string, string> = {},
): string {
	let result = expr;
	let searchIndex = 0;

	while (searchIndex < result.length) {
		const sumIndex = result.indexOf('\\sum', searchIndex);
		const prodIndex = result.indexOf('\\prod', searchIndex);
		const candidates = [sumIndex, prodIndex].filter(index => index !== -1);
		if (candidates.length === 0) {
			break;
		}

		const cmdIndex = Math.min(...candidates);
		const isProduct = cmdIndex === prodIndex;
		const command = isProduct ? '\\prod' : '\\sum';
		const usage = `Use ${command}_{i=1}^{n}{...}.`;

		let cursor = cmdIndex + command.length;
		while (cursor < result.length && /\s/.test(result[cursor])) {
			cursor++;
		}
		if (result[cursor] !== '_') {
			throw new GraphExpressionSyntaxError(`Invalid ${command} syntax. ${usage}`);
		}
		cursor++;

		const lowerGroup = findMatchingGroup(result, cursor, '{', '}');
		if (!lowerGroup) {
			throw new GraphExpressionSyntaxError(`Invalid ${command} lower bound. ${usage}`);
		}
		cursor = lowerGroup.end;

		while (cursor < result.length && /\s/.test(result[cursor])) {
			cursor++;
		}
		if (result[cursor] !== '^') {
			throw new GraphExpressionSyntaxError(`Invalid ${command} upper bound. ${usage}`);
		}
		cursor++;

		const upperGroup = findMatchingGroup(result, cursor, '{', '}');
		if (!upperGroup) {
			throw new GraphExpressionSyntaxError(`Invalid ${command} upper bound. ${usage}`);
		}
		cursor = upperGroup.end;

		while (cursor < result.length && /\s/.test(result[cursor])) {
			cursor++;
		}

		const bodyGroup = readFiniteLoopBody(result, cursor);
		if (!bodyGroup) {
			throw new GraphExpressionSyntaxError(
				`Invalid ${command} body. Wrap the term in braces or provide a term after the command.`,
			);
		}
		cursor = bodyGroup.end;

		const assignmentIndex = lowerGroup.content.indexOf('=');
		if (assignmentIndex === -1) {
			throw new GraphExpressionSyntaxError(`Invalid ${command} index. ${usage}`);
		}

		const loopName = lowerGroup.content.slice(0, assignmentIndex).trim();
		if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(loopName)) {
			throw new GraphExpressionSyntaxError(`Invalid ${command} index variable.`);
		}

		const start = normalizeFiniteLoopBound(lowerGroup.content.slice(assignmentIndex + 1), parameters, command);
		const end = normalizeFiniteLoopBound(upperGroup.content, parameters, command);
		if (Math.abs(end - start) > 256) {
			throw new GraphExpressionSyntaxError(`${command} range is too large to expand safely.`);
		}

		const expandedBody = expandFiniteLatexLoops(bodyGroup.content, parameters);
		const parts: string[] = [];
		if (start <= end) {
			for (let value = start; value <= end; value++) {
				parts.push(`(${substituteLoopVariable(expandedBody, loopName, value)})`);
			}
		}

		const joiner = isProduct ? '*' : '+';
		const emptyValue = isProduct ? '1' : '0';
		const replacement = parts.length > 0 ? parts.join(joiner) : emptyValue;
		result = `${result.slice(0, cmdIndex)}${replacement}${result.slice(cursor)}`;
		searchIndex = cmdIndex + replacement.length;
	}

	return result;
}

function readFiniteLoopBody(source: string, start: number): ParsedMathBody | null {
	const grouped = findMatchingGroup(source, start, '{', '}')
		?? findMatchingGroup(source, start, '(', ')');
	if (grouped) {
		return grouped;
	}

	let cursor = start;
	while (cursor < source.length && /\s/.test(source[cursor])) {
		cursor++;
	}
	if (cursor >= source.length) {
		return null;
	}

	let depthParen = 0;
	let depthBrace = 0;
	for (let i = cursor; i < source.length; i++) {
		const char = source[i];
		if (char === '\\') {
			i++;
			continue;
		}
		if (char === '{') depthBrace++;
		else if (char === '}') {
			if (depthBrace === 0) {
				return { content: source.slice(cursor, i).trim(), end: i };
			}
			depthBrace--;
		} else if (char === '(') depthParen++;
		else if (char === ')') {
			if (depthParen === 0) {
				return { content: source.slice(cursor, i).trim(), end: i };
			}
			depthParen--;
		}

		if (depthParen === 0 && depthBrace === 0 && i > cursor && /[+\-,;\n]/.test(char)) {
			return { content: source.slice(cursor, i).trim(), end: i };
		}
	}

	return { content: source.slice(cursor).trim(), end: source.length };
}

function stripLatexWrappers(expr: string): string {
	return expr
		.trim()
		.replace(/^\$\$?/, '')
		.replace(/\$\$?$/, '')
		.replace(/^\\\(/, '')
		.replace(/\\\)$/, '')
		.replace(/^\\\[/, '')
		.replace(/\\\]$/, '')
		.replace(/\\left\b/g, '')
		.replace(/\\right\b/g, '')
		.replace(/\\cdot\b/g, '*')
		.replace(/\\times\b/g, '*')
		.replace(/\\div\b/g, '/')
		.replace(/\\langle\b/g, '(')
		.replace(/\\rangle\b/g, ')')
		.replace(/\\[,!;:]/g, '')
		.replace(/\\operatorname\s*\{([^{}]+)\}/g, '$1')
		.replace(/\\mathrm\s*\{([^{}]+)\}/g, '$1')
		.replace(/\\text\s*\{([^{}]+)\}/g, '$1');
}

/** Expand \frac{a}{b} (and \dfrac, \tfrac, \cfrac) with support for nested braces. */
function expandLatexFractions(expr: string): string {
	let result = expr;
	for (let guard = 0; guard < 64; guard++) {
		const match = result.match(/\\[dtc]?frac\s*/);
		if (!match || match.index === undefined) {
			break;
		}

		const numerator = findMatchingGroup(result, match.index + match[0].length, '{', '}');
		if (!numerator) {
			break;
		}

		let cursor = numerator.end;
		while (cursor < result.length && /\s/.test(result[cursor])) {
			cursor++;
		}

		const denominator = findMatchingGroup(result, cursor, '{', '}');
		if (!denominator) {
			break;
		}

		result = `${result.slice(0, match.index)}((${numerator.content})/(${denominator.content}))${result.slice(denominator.end)}`;
	}
	return result;
}

/** Expand \sqrt[n]{x} into ((x)^(1/(n))) before the plain \sqrt replacement runs. */
function expandLatexRoots(expr: string): string {
	let result = expr;
	for (let guard = 0; guard < 64; guard++) {
		const match = result.match(/\\sqrt\s*\[/);
		if (!match || match.index === undefined) {
			break;
		}

		const bracketStart = result.indexOf('[', match.index);
		const index = findMatchingGroup(result, bracketStart, '[', ']');
		if (!index) {
			break;
		}

		let cursor = index.end;
		while (cursor < result.length && /\s/.test(result[cursor])) {
			cursor++;
		}

		const radicand = findMatchingGroup(result, cursor, '{', '}');
		if (!radicand) {
			break;
		}

		result = `${result.slice(0, match.index)}((${radicand.content})^(1/(${index.content})))${result.slice(radicand.end)}`;
	}
	return result;
}

function replaceGreekCommands(expr: string): string {
	let result = expr;
	for (const name of GREEK_LETTER_COMMANDS) {
		// (?![A-Za-z]) instead of \b — \theta_0 must still convert (\b fails before _).
		result = result.replace(new RegExp(`\\\\${name}(?![A-Za-z])`, 'g'), name);
	}
	for (const [glyph, name] of Object.entries(UNICODE_GREEK)) {
		result = result.replaceAll(glyph, name);
	}
	return result;
}

/** Convert log_b(x), log_{b}(x), and log_{b}{x} into (ln(x)/ln(b)). */
function expandLogBases(expr: string): string {
	let result = expr;
	for (let guard = 0; guard < 16 && result.includes('log_'); guard++) {
		const next = expandLogBasesOnce(result);
		if (next === result) {
			break;
		}
		result = next;
	}
	return result;
}

function expandLogBasesOnce(expr: string): string {
	let result = '';
	let i = 0;

	while (i < expr.length) {
		const idx = expr.indexOf('log_', i);
		if (idx === -1) {
			result += expr.slice(i);
			break;
		}

		const prev = idx > 0 ? expr[idx - 1] : '';
		if (/[A-Za-z0-9_]/.test(prev)) {
			result += expr.slice(i, idx + 4);
			i = idx + 4;
			continue;
		}

		let cursor = idx + 'log_'.length;
		let base: string | null = null;
		const bracedBase = findMatchingGroup(expr, cursor, '{', '}');
		if (bracedBase) {
			base = bracedBase.content;
			cursor = bracedBase.end;
		} else {
			const token = expr.slice(cursor).match(/^[A-Za-z0-9.]+/);
			if (token) {
				base = token[0];
				cursor += token[0].length;
			}
		}

		while (cursor < expr.length && /\s/.test(expr[cursor])) {
			cursor++;
		}

		const argGroup = findMatchingGroup(expr, cursor, '(', ')')
			?? findMatchingGroup(expr, cursor, '{', '}');
		if (!base || !argGroup) {
			throw new GraphExpressionSyntaxError(
				'Invalid log base syntax. Use log_2(x) or \\log_{10}{x}.',
			);
		}

		result += `${expr.slice(i, idx)}(ln(${argGroup.content})/ln(${base}))`;
		i = argGroup.end;
	}

	return result;
}

function normalizeUnicodeMath(expr: string): string {
	let result = expr
		.replace(/×/g, '*')
		.replace(/÷/g, '/')
		.replace(/·/g, '*')
		.replace(/−/g, '-')
		.replace(/√\s*(?=\()/g, 'sqrt')
		.replace(/√\s*([A-Za-z0-9.]+)/g, 'sqrt($1)');

	result = result.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, sequence => {
		const digits = sequence.split('').map(char => UNICODE_SUPERSCRIPTS[char] ?? '').join('');
		return digits ? `^(${digits})` : '';
	});

	return result;
}

/** After every brace-based LaTeX construct is expanded, treat leftover braces as grouping. */
function convertBracesToParens(expr: string): string {
	return expr.replace(/[{}]/g, char => (char === '{' ? '(' : ')'));
}

/** Convert |x| into abs(x). Nested bars are ambiguous and only simple pairs are supported. */
function convertAbsoluteValueBars(expr: string): string {
	let result = expr;
	for (let guard = 0; guard < 32 && result.includes('|'); guard++) {
		const next = result.replace(/\|([^|]+)\|/, 'abs($1)');
		if (next === result) {
			break;
		}
		result = next;
	}
	return result;
}

function stripLatexMathCommands(expr: string, parameters: Record<string, string> = {}): string {
	let result = stripLatexWrappers(expr);
	result = expandLatexFractions(result);
	result = expandLatexRoots(result);
	result = expandFiniteLatexLoops(result, parameters);

	result = result
		.replace(/\\arcsin\b/g, 'asin')
		.replace(/\\arccos\b/g, 'acos')
		.replace(/\\arctan\b/g, 'atan')
		.replace(/\\log_/g, 'log_')
		.replace(/\\(sinh|cosh|tanh|sin|cos|tan|sec|csc|cot|exp|ln|log|sqrt|abs|min|max|floor|ceil|round|sign)\b/g, '$1')
		.replace(/\\lfloor/g, 'floor(')
		.replace(/\\rfloor/g, ')')
		.replace(/\\lceil/g, 'ceil(')
		.replace(/\\rceil/g, ')')
		.replace(/⌊/g, 'floor(')
		.replace(/⌋/g, ')')
		.replace(/⌈/g, 'ceil(')
		.replace(/⌉/g, ')')
		.replace(/\\pi\b/g, 'pi')
		.replace(/π/g, 'pi');

	result = replaceGreekCommands(result);
	result = expandLogBases(result);
	result = normalizeUnicodeMath(result);
	result = convertBracesToParens(result);
	result = convertAbsoluteValueBars(result);
	return result;
}

export function normalizeFrontendMath(
	expr: string,
	options: FrontendMathNormalizeOptions = {},
): string {
	const parameters = options.parameters ?? {};
	const stripped = stripLatexMathCommands(expr.trim(), parameters);
	if (options.substituteParameters === false) {
		return stripped;
	}

	const substituted = substituteParameterValues(stripped, parameters);
	if (substituted === stripped) {
		return stripped;
	}
	// Parameter values may themselves contain LaTeX syntax — normalize again.
	return stripLatexMathCommands(substituted, parameters);
}

function substituteParameterValues(expr: string, parameters: Record<string, string>): string {
	if (Object.keys(parameters).length === 0) {
		return expr;
	}

	let result = expr;
	const names = Object.keys(parameters).sort((left, right) => right.length - left.length);
	for (const name of names) {
		const value = parameters[name]?.trim() ?? '';
		if (!name || !value) {
			continue;
		}
		// Never substitute over function names or pi — a parameter named "sin" would corrupt calls.
		if (KNOWN_FUNCTIONS.has(name.toLowerCase()) || name.toLowerCase() === 'pi') {
			continue;
		}
		const pattern = new RegExp(`(?<![A-Za-z])${escapeRegex(name)}(?![A-Za-z])`, 'g');
		result = result.replace(pattern, `(${value})`);
	}
	return result;
}

function splitIdentifierToken(value: string): string[] {
	if (KNOWN_FUNCTIONS.has(value.toLowerCase())) {
		return [value];
	}
	for (const fn of KNOWN_FUNCTIONS_BY_LENGTH) {
		if (value.length > fn.length && value.toLowerCase().endsWith(fn)) {
			const prefix = value.slice(0, -fn.length);
			if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(prefix)) {
				return [...splitIdentifierToken(prefix), value.slice(-fn.length)];
			}
		}
	}
	return [value];
}

function tokenize(source: string): Token[] {
	const tokens: Token[] = [];
	let index = 0;

	while (index < source.length) {
		const char = source[index];
		if (/\s/.test(char)) {
			index++;
			continue;
		}

		if ('+-*/^(),!'.includes(char)) {
			const map: Record<string, TokenType> = {
				'+': TokenType.Plus,
				'-': TokenType.Minus,
				'*': TokenType.Star,
				'/': TokenType.Slash,
				'^': TokenType.Caret,
				'(': TokenType.LParen,
				')': TokenType.RParen,
				',': TokenType.Comma,
				'!': TokenType.Bang,
			};
			tokens.push({ type: map[char], value: char });
			index++;
			continue;
		}

		if (/[0-9.]/.test(char)) {
			let end = index + 1;
			while (end < source.length && /[0-9.]/.test(source[end])) {
				end++;
			}
			tokens.push({ type: TokenType.Number, value: source.slice(index, end) });
			index = end;
			continue;
		}

		if (/[A-Za-z_]/.test(char)) {
			let end = index + 1;
			while (end < source.length && /[A-Za-z0-9_]/.test(source[end])) {
				end++;
			}
			const parts = splitIdentifierToken(source.slice(index, end));
			for (const part of parts) {
				tokens.push({ type: TokenType.Identifier, value: part });
			}
			index = end;
			continue;
		}

		throw new GraphExpressionSyntaxError();
	}

	for (let i = 0; i < tokens.length - 1; i++) {
		const current = tokens[i];
		const next = tokens[i + 1];
		if (current.type !== TokenType.Identifier || next.type !== TokenType.Identifier) {
			continue;
		}

		const left = current.value.toLowerCase();
		const right = next.value.toLowerCase();
		if (KNOWN_FUNCTIONS.has(right)) {
			continue;
		}
		if (KNOWN_FUNCTIONS.has(left)) {
			continue;
		}
		throw new GraphExpressionSyntaxError();
	}

	tokens.push({ type: TokenType.Eof, value: '' });
	return tokens;
}

function wrapPowerPart(value: string): string {
	if (/^[A-Za-z0-9.]+$/.test(value)) {
		return value;
	}
	if (value.startsWith('(') && value.endsWith(')')) {
		return value;
	}
	return `(${value})`;
}

/** Canonical short name for inverse trig aliases (arcsin → asin). */
function canonicalInverseTrigName(name: string): string {
	return name.startsWith('arc') ? `a${name.slice(3)}` : name;
}

class ExpressionParser {
	private index = 0;

	constructor(
		private readonly tokens: Token[],
		private readonly variables: Set<string>,
		private readonly target: CompileTarget = 'pgfplots',
	) {}

	parse(): string {
		const result = this.parseAddition();
		if (!this.match(TokenType.Eof)) {
			throw new GraphExpressionSyntaxError();
		}
		return result;
	}

	private parseAddition(): string {
		let result = this.parseMultiplication();
		while (this.match(TokenType.Plus, TokenType.Minus)) {
			const op = this.previous().value;
			const right = this.parseMultiplication();
			result = `${result}${op}${right}`;
		}
		return result;
	}

	private multiplyOperator(): string {
		return this.target === 'octave' ? '.*' : '*';
	}

	private divideOperator(): string {
		return this.target === 'octave' ? './' : '/';
	}

	private powerOperator(): string {
		return this.target === 'octave' ? '.^' : '^';
	}

	private parseMultiplication(): string {
		let result = this.parsePower();
		while (this.implicitMultiplyNext() || this.match(TokenType.Star, TokenType.Slash)) {
			let op: string;
			if (this.previous().type === TokenType.Star) {
				op = this.multiplyOperator();
			} else if (this.previous().type === TokenType.Slash) {
				op = this.divideOperator();
			} else {
				op = this.multiplyOperator();
			}
			const right = this.parsePower();
			result = `${result}${op}${right}`;
		}
		return result;
	}

	private parsePower(): string {
		let base = this.parseUnary();
		while (this.match(TokenType.Caret)) {
			const exponent = this.parseUnary();
			const op = this.powerOperator();
			base = `${wrapPowerPart(base)}${op}${wrapPowerPart(exponent)}`;
		}
		return base;
	}

	private parseUnary(): string {
		if (this.match(TokenType.Plus)) {
			return this.parseUnary();
		}
		if (this.match(TokenType.Minus)) {
			return `-${this.parsePower()}`;
		}
		return this.parsePostfix();
	}

	/** Handles postfix factorial: x!, (x+1)!, 5!! is treated as factorial(factorial(5)). */
	private parsePostfix(): string {
		let base = this.parsePrimary();
		while (this.match(TokenType.Bang)) {
			base = `factorial(${base})`;
		}
		return base;
	}

	private parsePrimary(): string {
		if (this.match(TokenType.Number)) {
			return this.previous().value;
		}

		if (this.match(TokenType.LParen)) {
			const inner = this.parseAddition();
			if (!this.match(TokenType.RParen)) {
				throw new GraphExpressionSyntaxError();
			}
			return `(${inner})`;
		}

		if (this.match(TokenType.Identifier)) {
			const rawName = this.previous().value;
			const name = rawName.toLowerCase();

			if (name === 'e' && this.match(TokenType.Caret)) {
				const exponent = this.parseExponentForExp();
				return `exp(${exponent})`;
			}

			if (name === 'pi') {
				return 'pi';
			}

			if (TRIG_FUNCTIONS.has(name)) {
				return this.parseTrigFunction(name);
			}

			if (INVERSE_TRIG_FUNCTIONS.has(name)) {
				return this.parseInverseTrigFunction(canonicalInverseTrigName(name));
			}

			if (INVERSE_HYPERBOLIC_FUNCTIONS.has(name)) {
				return this.parseInverseHyperbolicFunction(name);
			}

			if (name === 'ln') {
				return this.parseNamedFunction(this.target === 'octave' ? 'log' : 'ln');
			}

			if (HYPERBOLIC_FUNCTIONS.has(name) || name === 'sqrt' || name === 'exp' || name === 'abs') {
				return this.parseNamedFunction(name);
			}

			if (name === 'log') {
				return this.parseLogFunction();
			}

			if (SINGLE_ARG_FUNCTIONS.has(name)) {
				return this.parseNamedFunction(name);
			}

			if (VARIADIC_FUNCTIONS.has(name)) {
				return this.parseVariadicFunction(name);
			}

			if (name === 'mod' || name === 'atan2' || name === 'pow') {
				return this.parseTwoArgFunction(name);
			}

			if (name === 'deg') {
				return this.parseNamedFunction(name);
			}

			return rawName;
		}

		throw new GraphExpressionSyntaxError();
	}

	private trigEmitName(name: string): string {
		if (name === 'csc' || name === 'cosec') {
			return this.target === 'octave' ? 'csc' : 'cosec';
		}
		return name;
	}

	private parseTrigFunction(name: string): string {
		const emitName = this.trigEmitName(name);
		if (this.match(TokenType.Caret)) {
			const exponent = this.readExponentToken();
			const argument = this.parseFunctionArgument();
			if (this.target === 'octave') {
				return `${emitName}(${argument}).^${exponent}`;
			}
			return `(${emitName}(${wrapTrigArgument(argument)}))^${exponent}`;
		}

		if (this.match(TokenType.LParen)) {
			const argument = this.parseAddition();
			if (!this.match(TokenType.RParen)) {
				throw new GraphExpressionSyntaxError();
			}
			if (this.target === 'octave') {
				return `${emitName}(${argument})`;
			}
			return `${emitName}(${wrapTrigArgument(argument)})`;
		}

		throw new GraphExpressionSyntaxError();
	}

	/** PGF inverse trig returns degrees; wrap with rad() so results stay in radians. */
	private parseInverseTrigFunction(name: string): string {
		let exponent: string | null = null;
		if (this.match(TokenType.Caret)) {
			exponent = this.readExponentToken();
		}

		const argument = this.parseFunctionArgument();
		const call = this.target === 'octave'
			? `${name}(${argument})`
			: `rad(${name}(${argument}))`;

		if (exponent === null) {
			return call;
		}
		return this.target === 'octave'
			? `${call}.^${exponent}`
			: `(${call})^${exponent}`;
	}

	/** PGF math has no inverse hyperbolic functions — expand to logarithms. */
	private parseInverseHyperbolicFunction(name: string): string {
		const argument = this.parseFunctionArgument();
		if (this.target === 'octave') {
			return `${name}(${argument})`;
		}
		const a = `(${argument})`;
		switch (name) {
			case 'asinh':
				return `ln(${a} + sqrt(${a}^2+1))`;
			case 'acosh':
				return `ln(${a} + sqrt(${a}^2-1))`;
			default:
				return `(0.5*ln((1+${a})/(1-${a})))`;
		}
	}

	private parseExponentForExp(): string {
		if (this.match(TokenType.LParen)) {
			const inner = this.parseAddition();
			if (!this.match(TokenType.RParen)) {
				throw new GraphExpressionSyntaxError();
			}
			return inner;
		}
		return this.parsePower();
	}

	private parseNamedFunction(name: string): string {
		const args = this.parseCallArguments();
		if (args.length !== 1) {
			throw new GraphExpressionSyntaxError();
		}
		return `${name}(${args[0]})`;
	}

	private parseLogFunction(): string {
		const args = this.parseCallArguments();
		if (args.length === 1) {
			return this.target === 'octave' ? `log(${args[0]})` : `ln(${args[0]})`;
		}
		// log(b, x) is treated as logarithm of x in base b.
		if (args.length === 2) {
			const op = this.divideOperator();
			return this.target === 'octave'
				? `(log(${args[1]})${op}log(${args[0]}))`
				: `(ln(${args[1]})${op}ln(${args[0]}))`;
		}
		throw new GraphExpressionSyntaxError();
	}

	/** min/max with any number of arguments; nested for Octave scalar semantics. */
	private parseVariadicFunction(name: string): string {
		const args = this.parseCallArguments();
		if (args.length === 0) {
			throw new GraphExpressionSyntaxError();
		}
		if (args.length === 1) {
			return `(${args[0]})`;
		}
		let result = args[args.length - 1];
		for (let i = args.length - 2; i >= 0; i--) {
			result = `${name}(${args[i]}, ${result})`;
		}
		return result;
	}

	private parseTwoArgFunction(name: string): string {
		const args = this.parseCallArguments();
		if (args.length !== 2) {
			throw new GraphExpressionSyntaxError();
		}
		if (name === 'pow') {
			return `${wrapPowerPart(`(${args[0]})`)}${this.powerOperator()}${wrapPowerPart(`(${args[1]})`)}`;
		}
		if (name === 'atan2') {
			return this.target === 'octave'
				? `atan2(${args[0]}, ${args[1]})`
				: `rad(atan2(${args[0]}, ${args[1]}))`;
		}
		return `${name}(${args[0]}, ${args[1]})`;
	}

	private parseCallArguments(): string[] {
		if (!this.match(TokenType.LParen)) {
			throw new GraphExpressionSyntaxError();
		}
		const args: string[] = [];
		if (this.match(TokenType.RParen)) {
			return args;
		}
		do {
			args.push(this.parseAddition());
		} while (this.match(TokenType.Comma));
		if (!this.match(TokenType.RParen)) {
			throw new GraphExpressionSyntaxError();
		}
		return args;
	}

	private parseFunctionArgument(): string {
		if (!this.match(TokenType.LParen)) {
			throw new GraphExpressionSyntaxError();
		}
		const argument = this.parseAddition();
		if (!this.match(TokenType.RParen)) {
			throw new GraphExpressionSyntaxError();
		}
		return argument;
	}

	private readExponentToken(): string {
		if (this.match(TokenType.Number)) {
			return this.previous().value;
		}
		if (this.match(TokenType.LParen)) {
			const inner = this.parseAddition();
			if (!this.match(TokenType.RParen)) {
				throw new GraphExpressionSyntaxError();
			}
			return `(${inner})`;
		}
		return this.parseUnary();
	}

	private implicitMultiplyNext(): boolean {
		const next = this.peek();
		return next.type === TokenType.Number
			|| next.type === TokenType.Identifier
			|| next.type === TokenType.LParen;
	}

	private match(...types: TokenType[]): boolean {
		for (const type of types) {
			if (this.peek().type === type) {
				this.index++;
				return true;
			}
		}
		return false;
	}

	private previous(): Token {
		return this.tokens[this.index - 1];
	}

	private peek(): Token {
		return this.tokens[this.index];
	}
}

function compileExpression(
	input: string,
	context: GraphExpressionContext,
	target: CompileTarget,
): string {
	const trimmed = input.trim();
	if (!trimmed) {
		throw new GraphExpressionSyntaxError();
	}

	const variables = context.variables ?? DEFAULT_VARIABLES;
	const parameters = context.parameters ?? {};
	const parameterNames = Object.keys(parameters);
	const prepared = target === 'octave'
		? normalizeFrontendMath(trimmed, { parameters, substituteParameters: false })
		: normalizeFrontendMath(trimmed, { parameters, substituteParameters: true });
	const variableSet = new Set([
		...DEFAULT_VARIABLES,
		...variables.map(name => name.trim()).filter(Boolean),
		...parameterNames,
	]);

	try {
		const parser = new ExpressionParser(tokenize(prepared), variableSet, target);
		return parser.parse();
	} catch (err) {
		if (err instanceof GraphExpressionSyntaxError) {
			throw err;
		}
		throw new GraphExpressionSyntaxError();
	}
}

/**
 * Convert Desmos-style user math into PGFPlots-safe syntax at render time.
 * Never show the result to the user in the normal GUI.
 *
 * log(x) → ln(x) (natural logarithm).
 */
export function compileExpressionForPgfplots(
	input: string,
	context: GraphExpressionContext = {},
): string {
	return compileExpression(input, context, 'pgfplots');
}

/**
 * Convert Desmos-style user math into Octave elementwise syntax for numeric sampling.
 * Trig uses radians (no deg()). Matrix operators become elementwise (.*, ./, .^).
 */
export function compileExpressionForOctave(
	input: string,
	context: GraphExpressionContext = {},
): string {
	return compileExpression(input, context, 'octave');
}

/** @deprecated Prefer compileExpressionForPgfplots */
export function normalizeUserExpressionForPgfplots(
	input: string,
	context: GraphExpressionContext = {},
): string {
	return compileExpressionForPgfplots(input, context);
}

/** @deprecated Use normalizeUserExpressionForPgfplots */
export function normalizeExpressionForPgfplots(
	input: string,
	variables: string[] = DEFAULT_VARIABLES,
	parameters: Record<string, string> = {},
): string {
	return compileExpressionForPgfplots(input, { variables, parameters });
}

export function graphParametersToRecord(
	parameters: Array<{ name: string; value: string }>,
): Record<string, string> {
	const record: Record<string, string> = {};
	for (const param of parameters) {
		const bare = param.name.trim().replace(/^\\/, '');
		if (bare) {
			record[bare] = param.value;
		}
	}
	return record;
}

/** Detect Octave elementwise operators that must not be stored in graph JSON. */
export function containsOctaveCompiledSyntax(input: string): boolean {
	return /\.\^|\.\*|\.\//.test(input);
}

/**
 * Restore user-friendly syntax if compiled Octave operators were saved accidentally.
 * User syntax uses ^, *, / — never .^, .*, ./
 */
export function sanitizeUserExpressionForStorage(input: string): string {
	return input
		.replace(/\.\^/g, '^')
		.replace(/\.\*/g, '*')
		.replace(/\.\//g, '/')
		.trim();
}

/** @internal Exported for unit tests. */
export const __testing = {
	tokenize,
	stripLatexMathCommands,
	substituteParameterValues,
	normalizeFrontendMath,
};
