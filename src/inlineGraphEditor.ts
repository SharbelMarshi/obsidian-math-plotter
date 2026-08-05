import type { Extension } from '@codemirror/state';
import { RangeSetBuilder } from '@codemirror/state';
import {
	Decoration,
	EditorView,
	ViewPlugin,
	type DecorationSet,
	type ViewUpdate,
} from '@codemirror/view';
import { expandGraphSyntax } from '../graphPreprocessor';
import { GraphSyntaxError } from '../graphExpression';

interface EditorDiagnostic {
	from: number;
	to: number;
	message: string;
}

interface JsonErrorLocation {
	line: number;
	column: number;
}

interface GraphBlockEditorClassification {
	state: 'empty' | 'valid' | 'invalid';
	error?: string;
}

function classifyGraphBlockSourceForEditor(source: string): GraphBlockEditorClassification {
	const trimmed = source.trim();
	if (!trimmed) {
		return { state: 'empty' };
	}

	try {
		const parsed = JSON.parse(trimmed) as unknown;
		if (
			!parsed
			|| typeof parsed !== 'object'
			|| (parsed as { version?: unknown }).version !== 1
			|| typeof (parsed as { type?: unknown }).type !== 'string'
		) {
			return { state: 'invalid', error: 'Graph block is missing required fields.' };
		}
		return { state: 'valid' };
	} catch (err) {
		return {
			state: 'invalid',
			error: err instanceof Error ? err.message : 'Invalid graph JSON.',
		};
	}
}

function offsetToLineColumn(source: string, offset: number): JsonErrorLocation {
	const safeOffset = Math.max(0, Math.min(offset, source.length));
	const before = source.slice(0, safeOffset);
	const parts = before.split('\n');
	return {
		line: parts.length,
		column: (parts.at(-1)?.length ?? 0) + 1,
	};
}

function lineColumnToOffset(source: string, line: number, column = 1): number {
	const lines = source.split('\n');
	let offset = 0;
	for (let index = 0; index < lines.length; index++) {
		if (index + 1 === line) {
			return offset + Math.max(0, column - 1);
		}
		offset += lines[index].length + 1;
	}
	return source.length;
}

function parseJsonErrorLocation(source: string, message: string): JsonErrorLocation | null {
	const offsetMatch = /position\s+(\d+)/i.exec(message);
	if (!offsetMatch) {
		return null;
	}
	return offsetToLineColumn(source, Number.parseInt(offsetMatch[1], 10));
}

function diagnosticRangeForLine(
	source: string,
	baseOffset: number,
	line: number,
	column = 1,
): Pick<EditorDiagnostic, 'from' | 'to'> {
	const lineStart = baseOffset + lineColumnToOffset(source, line, 1);
	const targetOffset = baseOffset + lineColumnToOffset(source, line, column);
	const lineText = source.split('\n')[Math.max(0, line - 1)] ?? '';
	const localColumn = Math.max(1, Math.min(column, lineText.length + 1));
	const tail = lineText.slice(localColumn - 1);
	const width = Math.max(1, /^[^\s,;:()[\]{}]+/.exec(tail)?.[0]?.length ?? 1);
	return {
		from: targetOffset,
		to: Math.min(lineStart + lineText.length, targetOffset + width),
	};
}

function collectFenceDiagnostics(source: string): EditorDiagnostic[] {
	const diagnostics: EditorDiagnostic[] = [];
	const lines = source.split('\n');
	const lineOffsets: number[] = [];
	let offset = 0;
	for (const line of lines) {
		lineOffsets.push(offset);
		offset += line.length + 1;
	}

	for (let index = 0; index < lines.length; index++) {
		if (!lines[index].trim().startsWith('```graph')) {
			continue;
		}

		let end = index + 1;
		while (end < lines.length && lines[end].trim() !== '```') {
			end++;
		}
		if (end >= lines.length) {
			break;
		}

		const bodyLines = lines.slice(index + 1, end);
		const body = bodyLines.join('\n');
		if (!body.trim()) {
			index = end;
			continue;
		}

		const classification = classifyGraphBlockSourceForEditor(body);
		if (classification.state !== 'invalid') {
			index = end;
			continue;
		}

		let line = 1;
		let column = 1;
		try {
			JSON.parse(body);
			line = bodyLines.findIndex(text => text.trim().length > 0) + 1;
		} catch (err) {
			const location = err instanceof Error ? parseJsonErrorLocation(body, err.message) : null;
			line = location?.line ?? 1;
			column = location?.column ?? 1;
		}

		const bodyOffset = end > index + 1 ? lineOffsets[index + 1] : lineOffsets[index] + lines[index].length + 1;
		const range = diagnosticRangeForLine(body, bodyOffset, line, column);
		diagnostics.push({
			...range,
			message: classification.error ?? 'Invalid graph block.',
		});

		index = end;
	}

	return diagnostics;
}

function collectLatexGraphDiagnostics(source: string): EditorDiagnostic[] {
	const diagnostics: EditorDiagnostic[] = [];
	const pattern = /\\begin\{graph\}([\s\S]*?)\\end\{graph\}/g;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(source)) !== null) {
		try {
			expandGraphSyntax(match[0]);
		} catch (err) {
			if (!(err instanceof GraphSyntaxError)) {
				continue;
			}
			const line = Math.max(1, err.line ?? 1);
			const range = diagnosticRangeForLine(match[0], match.index, line, 1);
			diagnostics.push({
				...range,
				message: err.message,
			});
		}
	}

	return diagnostics;
}

export function collectGraphEditorDiagnostics(source: string): EditorDiagnostic[] {
	return [
		...collectFenceDiagnostics(source),
		...collectLatexGraphDiagnostics(source),
	];
}

function buildDecorations(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const lineDecoration = Decoration.line({ class: 'cm-mathgraph-error-line' });

	for (const diagnostic of collectGraphEditorDiagnostics(view.state.doc.toString())) {
		const line = view.state.doc.lineAt(diagnostic.from);
		builder.add(line.from, line.from, lineDecoration);
		builder.add(
			diagnostic.from,
			Math.max(diagnostic.from + 1, diagnostic.to),
			Decoration.mark({
				class: 'cm-mathgraph-error-zigzag',
				attributes: {
					title: diagnostic.message,
					'aria-label': diagnostic.message,
				},
			}),
		);
	}

	return builder.finish();
}

export function inlineGraphEditorExtension(): Extension {
	return [
		ViewPlugin.fromClass(class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildDecorations(view);
			}

			update(update: ViewUpdate): void {
				if (update.docChanged || update.viewportChanged) {
					this.decorations = buildDecorations(update.view);
				}
			}
		}, {
			decorations: value => value.decorations,
		}),
	];
}
