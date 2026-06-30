export type MathScope = Record<string, number>;

export interface SafeMathEvalOptions {
	trigDegrees?: boolean;
}

export class SafeMathSyntaxError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SafeMathSyntaxError';
	}
}

const MATH_FUNCTIONS = new Set([
	'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
	'sinh', 'cosh', 'tanh', 'sqrt', 'abs', 'log', 'ln', 'log10',
	'exp', 'floor', 'ceil', 'round', 'min', 'max', 'pow', 'deg',
]);

const CONSTANTS: Record<string, number> = {
	pi: Math.PI,
	e: Math.E,
};

const JS_KEYWORDS = new Set([
	'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
	'delete', 'do', 'else', 'export', 'extends', 'false', 'finally', 'for', 'function',
	'if', 'import', 'in', 'instanceof', 'let', 'new', 'null', 'return', 'super',
	'switch', 'this', 'throw', 'true', 'try', 'typeof', 'undefined', 'var', 'void',
	'while', 'with', 'yield',
]);

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

const DISALLOWED_CHARS = /[;[\]`'"=<>!&|?{}\\@#$%]/;

function tokenize(input: string): Token[] {
	const trimmed = input.trim();
	if (!trimmed) {
		throw new SafeMathSyntaxError('Expression is empty.');
	}
	if (DISALLOWED_CHARS.test(trimmed)) {
		throw new SafeMathSyntaxError('Expression contains disallowed characters.');
	}

	const tokens: Token[] = [];
	let index = 0;

	while (index < trimmed.length) {
		const ch = trimmed[index];
		if (/\s/.test(ch)) {
			index++;
			continue;
		}

		if (/[\d.]/.test(ch)) {
			let end = index;
			while (end < trimmed.length) {
				const current = trimmed[end];
				if (/[\d.]/.test(current)) {
					end++;
					continue;
				}
				if ((current === 'e' || current === 'E') && end + 1 < trimmed.length) {
					end++;
					if (trimmed[end] === '+' || trimmed[end] === '-') {
						end++;
					}
					while (end < trimmed.length && /\d/.test(trimmed[end])) {
						end++;
					}
					continue;
				}
				break;
			}
			const value = trimmed.slice(index, end);
			if (!Number.isFinite(Number.parseFloat(value))) {
				throw new SafeMathSyntaxError(`Invalid number: ${value}`);
			}
			tokens.push({ type: TokenType.Number, value });
			index = end;
			continue;
		}

		if (/[A-Za-z_]/.test(ch)) {
			let end = index + 1;
			while (end < trimmed.length && /[A-Za-z0-9_]/.test(trimmed[end])) {
				end++;
			}
			tokens.push({ type: TokenType.Identifier, value: trimmed.slice(index, end) });
			index = end;
			continue;
		}

		switch (ch) {
			case '+':
				tokens.push({ type: TokenType.Plus, value: ch });
				break;
			case '-':
				tokens.push({ type: TokenType.Minus, value: ch });
				break;
			case '*':
				tokens.push({ type: TokenType.Star, value: ch });
				break;
			case '/':
				tokens.push({ type: TokenType.Slash, value: ch });
				break;
			case '^':
				tokens.push({ type: TokenType.Caret, value: ch });
				break;
			case '(':
				tokens.push({ type: TokenType.LParen, value: ch });
				break;
			case ')':
				tokens.push({ type: TokenType.RParen, value: ch });
				break;
			case ',':
				tokens.push({ type: TokenType.Comma, value: ch });
				break;
			default:
				throw new SafeMathSyntaxError(`Unexpected character: ${ch}`);
		}
		index++;
	}

	tokens.push({ type: TokenType.Eof, value: '' });
	return tokens;
}

class Parser {
	private index = 0;

	constructor(
		private readonly tokens: Token[],
		private readonly allowedVariables: ReadonlySet<string>,
		private readonly options: SafeMathEvalOptions,
	) {}

	parse(): (scope: MathScope) => number {
		const expr = this.parseExpression();
		if (this.peek().type !== TokenType.Eof) {
			throw new SafeMathSyntaxError('Unexpected trailing tokens.');
		}
		return scope => {
			try {
				const result = expr(scope);
				return typeof result === 'number' && Number.isFinite(result) ? result : Number.NaN;
			} catch {
				return Number.NaN;
			}
		};
	}

	private parseExpression(): (scope: MathScope) => number {
		return this.parseAddition();
	}

	private parseAddition(): (scope: MathScope) => number {
		let left = this.parseMultiplication();
		while (this.match(TokenType.Plus, TokenType.Minus)) {
			const op = this.previous().type;
			const right = this.parseMultiplication();
			const prevLeft = left;
			left = scope => {
				const a = prevLeft(scope);
				const b = right(scope);
				return op === TokenType.Plus ? a + b : a - b;
			};
		}
		return left;
	}

	private parseMultiplication(): (scope: MathScope) => number {
		let left = this.parsePower();
		while (this.match(TokenType.Star, TokenType.Slash)) {
			const op = this.previous().type;
			const right = this.parsePower();
			const prevLeft = left;
			left = scope => {
				const a = prevLeft(scope);
				const b = right(scope);
				return op === TokenType.Star ? a * b : a / b;
			};
		}
		return left;
	}

	private parsePower(): (scope: MathScope) => number {
		let left = this.parseUnary();
		if (this.match(TokenType.Caret)) {
			const right = this.parsePower();
			const base = left;
			left = scope => Math.pow(base(scope), right(scope));
		}
		return left;
	}

	private parseUnary(): (scope: MathScope) => number {
		if (this.match(TokenType.Minus)) {
			const inner = this.parseUnary();
			return scope => -inner(scope);
		}
		if (this.match(TokenType.Plus)) {
			return this.parseUnary();
		}
		return this.parsePostfix();
	}

	private parsePostfix(): (scope: MathScope) => number {
		const token = this.tokens[this.index];
		if (token.type === TokenType.Identifier) {
			const lower = token.value.toLowerCase();
			if (MATH_FUNCTIONS.has(lower)) {
				this.index++;
				if (!this.match(TokenType.LParen)) {
					throw new SafeMathSyntaxError(`Function ${token.value} requires parentheses.`);
				}
				const args = this.parseArgumentValues();
				if (!this.match(TokenType.RParen)) {
					throw new SafeMathSyntaxError('Expected closing parenthesis.');
				}
				return scope => this.invokeFunction(lower, args.map(arg => arg(scope)), scope);
			}
		}
		return this.parsePrimary();
	}

	private parseArgumentValues(): Array<(scope: MathScope) => number> {
		const args: Array<(scope: MathScope) => number> = [];
		if (this.check(TokenType.RParen)) {
			return args;
		}
		do {
			args.push(this.parseExpression());
		} while (this.match(TokenType.Comma));
		return args;
	}

	private parsePrimary(): (scope: MathScope) => number {
		if (this.match(TokenType.Number)) {
			const value = Number.parseFloat(this.previous().value);
			return () => value;
		}

		if (this.match(TokenType.Identifier)) {
			const name = this.previous().value;
			const lower = name.toLowerCase();

			if (JS_KEYWORDS.has(lower)) {
				throw new SafeMathSyntaxError(`Disallowed identifier: ${name}`);
			}

			if (lower in CONSTANTS) {
				return () => CONSTANTS[lower];
			}

			if (!this.allowedVariables.has(name)) {
				throw new SafeMathSyntaxError(`Unknown identifier: ${name}`);
			}

			return scope => {
				const value = scope[name];
				return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
			};
		}

		if (this.match(TokenType.LParen)) {
			const inner = this.parseExpression();
			if (!this.match(TokenType.RParen)) {
				throw new SafeMathSyntaxError('Expected closing parenthesis.');
			}
			return inner;
		}

		throw new SafeMathSyntaxError('Unexpected token in expression.');
	}

	private invokeFunction(name: string, args: number[], scope: MathScope): number {
		const trig = this.options.trigDegrees ?? false;
		const deg = (value: number) => (value * Math.PI) / 180;
		const rad = (value: number) => value;

		switch (name) {
			case 'sin':
				return Math.sin(trig ? deg(args[0] ?? Number.NaN) : rad(args[0] ?? Number.NaN));
			case 'cos':
				return Math.cos(trig ? deg(args[0] ?? Number.NaN) : rad(args[0] ?? Number.NaN));
			case 'tan':
				return Math.tan(trig ? deg(args[0] ?? Number.NaN) : rad(args[0] ?? Number.NaN));
			case 'asin':
				return Math.asin(args[0] ?? Number.NaN);
			case 'acos':
				return Math.acos(args[0] ?? Number.NaN);
			case 'atan':
				return Math.atan(args[0] ?? Number.NaN);
			case 'sinh':
				return Math.sinh(args[0] ?? Number.NaN);
			case 'cosh':
				return Math.cosh(args[0] ?? Number.NaN);
			case 'tanh':
				return Math.tanh(args[0] ?? Number.NaN);
			case 'sqrt':
				return Math.sqrt(args[0] ?? Number.NaN);
			case 'abs':
				return Math.abs(args[0] ?? Number.NaN);
			case 'log':
			case 'ln':
				return Math.log(args[0] ?? Number.NaN);
			case 'log10':
				return Math.log10(args[0] ?? Number.NaN);
			case 'exp':
				return Math.exp(args[0] ?? Number.NaN);
			case 'floor':
				return Math.floor(args[0] ?? Number.NaN);
			case 'ceil':
				return Math.ceil(args[0] ?? Number.NaN);
			case 'round':
				return Math.round(args[0] ?? Number.NaN);
			case 'min':
				return Math.min(args[0] ?? Number.NaN, args[1] ?? Number.NaN);
			case 'max':
				return Math.max(args[0] ?? Number.NaN, args[1] ?? Number.NaN);
			case 'pow':
				return Math.pow(args[0] ?? Number.NaN, args[1] ?? Number.NaN);
			case 'deg':
				return deg(args[0] ?? Number.NaN);
			default:
				return Number.NaN;
		}
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

	private check(type: TokenType): boolean {
		return this.peek().type === type;
	}

	private previous(): Token {
		return this.tokens[this.index - 1];
	}

	private peek(): Token {
		return this.tokens[this.index];
	}
}

function normalizeExpressionInput(expression: string): string {
	return expression
		.replace(/\*\*/g, '^')
		.replace(/\\pi\b/g, 'pi')
		.replace(/\\lambda\b/g, '1')
		.replace(/π/g, 'pi');
}

export function compileSafeMathExpression(
	expression: string,
	allowedVariables: readonly string[],
	options: SafeMathEvalOptions = {},
): (scope: MathScope) => number {
	const normalized = normalizeExpressionInput(expression);
	const tokens = tokenize(normalized);
	const allowed = new Set(allowedVariables);
	const parser = new Parser(tokens, allowed, options);
	return parser.parse();
}

export function evaluateSafeMathExpression(
	expression: string,
	scope: MathScope,
	allowedVariables: readonly string[],
	options: SafeMathEvalOptions = {},
): number {
	try {
		return compileSafeMathExpression(expression, allowedVariables, options)(scope);
	} catch {
		return Number.NaN;
	}
}

/** @internal Exported for unit tests. */
export const __testing = {
	tokenize,
};
