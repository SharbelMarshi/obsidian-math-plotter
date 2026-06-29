/**
 * Prepare user expressions for Octave evaluation.
 * Compiles from the original user syntax — never from PGFPlots-normalized output.
 */

import {
	compileExpressionForOctave,
	GraphExpressionSyntaxError,
	type GraphExpressionContext,
} from '../graphSyntax';

export { GraphExpressionSyntaxError };

export function expressionToOctave(
	input: string,
	context: GraphExpressionContext = {},
): string {
	return compileExpressionForOctave(input, context);
}

export function rangeBoundToOctave(value: string, fallback: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		return fallback;
	}
	return expressionToOctave(trimmed);
}
