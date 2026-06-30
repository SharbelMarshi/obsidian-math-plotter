/**
 * Converts user-friendly math syntax into PGFPlots-compatible expressions.
 *
 * Trigonometry: user input is in radians; PGF math uses degrees, so sin(x) → sin(deg(x)).
 * Logarithm: log(x) is treated as the natural logarithm and becomes ln(x).
 */

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

const TRIG_FUNCTIONS = new Set(['sin', 'cos', 'tan']);
const HYPERBOLIC_FUNCTIONS = new Set(['sinh', 'cosh', 'tanh']);
const KNOWN_FUNCTIONS = new Set([
	'sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh',
	'exp', 'ln', 'log', 'sqrt', 'abs', 'deg', 'min', 'max',
]);

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
	Eof,
}

interface Token {
	type: TokenType;
	value: string;
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripLatexMathCommands(expr: string): string {
	let result = expr;
	let prev = '';
	while (result !== prev) {
		prev = result;
		result = result.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '(($1)/($2))');
	}

	return result
		.replace(/\\sin\b/g, 'sin')
		.replace(/\\cos\b/g, 'cos')
		.replace(/\\tan\b/g, 'tan')
		.replace(/\\sinh\b/g, 'sinh')
		.replace(/\\cosh\b/g, 'cosh')
		.replace(/\\tanh\b/g, 'tanh')
		.replace(/\\exp\b/g, 'exp')
		.replace(/\\ln\b/g, 'ln')
		.replace(/\\log\b/g, 'log')
		.replace(/\\sqrt\b/g, 'sqrt')
		.replace(/\\abs\b/g, 'abs')
		.replace(/\\pi\b/g, 'pi')
		.replace(/π/g, 'pi');
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
		const pattern = new RegExp(`(?<![A-Za-z])${escapeRegex(name)}(?![A-Za-z])`, 'g');
		result = result.replace(pattern, `(${value})`);
	}
	return result;
}

function splitIdentifierToken(value: string): string[] {
	for (const fn of KNOWN_FUNCTIONS) {
		if (value.length > fn.length && value.toLowerCase().endsWith(fn)) {
			const prefix = value.slice(0, -fn.length);
			if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(prefix)) {
				return [prefix, value.slice(-fn.length)];
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

		if ('+-*/^(),'.includes(char)) {
			const map: Record<string, TokenType> = {
				'+': TokenType.Plus,
				'-': TokenType.Minus,
				'*': TokenType.Star,
				'/': TokenType.Slash,
				'^': TokenType.Caret,
				'(': TokenType.LParen,
				')': TokenType.RParen,
				',': TokenType.Comma,
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
		return this.parsePrimary();
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

			if (name === 'ln') {
				return this.parseNamedFunction(this.target === 'octave' ? 'log' : 'ln');
			}

			if (HYPERBOLIC_FUNCTIONS.has(name) || name === 'sqrt' || name === 'exp' || name === 'abs') {
				return this.parseNamedFunction(name);
			}

			if (name === 'log') {
				return this.parseLogFunction();
			}

			if (name === 'deg') {
				return this.parseNamedFunction(name);
			}

			return rawName;
		}

		throw new GraphExpressionSyntaxError();
	}

	private parseTrigFunction(name: string): string {
		if (this.match(TokenType.Caret)) {
			const exponent = this.readExponentToken();
			const argument = this.parseFunctionArgument();
			if (this.target === 'octave') {
				return `${name}(${argument}).^${exponent}`;
			}
			return `(${name}(${wrapTrigArgument(argument)}))^${exponent}`;
		}

		if (this.match(TokenType.LParen)) {
			const argument = this.parseAddition();
			if (!this.match(TokenType.RParen)) {
				throw new GraphExpressionSyntaxError();
			}
			if (this.target === 'octave') {
				return `${name}(${argument})`;
			}
			return `${name}(${wrapTrigArgument(argument)})`;
		}

		throw new GraphExpressionSyntaxError();
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
		if (!this.match(TokenType.LParen)) {
			throw new GraphExpressionSyntaxError();
		}
		const argument = this.parseAddition();
		if (!this.match(TokenType.RParen)) {
			throw new GraphExpressionSyntaxError();
		}
		return `${name}(${argument})`;
	}

	private parseLogFunction(): string {
		if (!this.match(TokenType.LParen)) {
			throw new GraphExpressionSyntaxError();
		}
		const argument = this.parseAddition();
		if (!this.match(TokenType.RParen)) {
			throw new GraphExpressionSyntaxError();
		}
		return this.target === 'octave' ? `log(${argument})` : `ln(${argument})`;
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
		? stripLatexMathCommands(trimmed)
		: stripLatexMathCommands(substituteParameterValues(trimmed, parameters));
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
};
