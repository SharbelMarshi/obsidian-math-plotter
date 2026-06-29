import { MarkdownView, type App, TFile, type MarkdownPostProcessorContext } from 'obsidian';
import { hydrateGraphSpec, serializeGraphSpec, type GraphSpec } from './graphSpec';
import type { MathGraphSettings } from './settings';
import { isRecord } from './settingsGuards';

function isGraphSpec(value: unknown): value is GraphSpec {
	if (!isRecord(value)) {
		return false;
	}
	return value.version === 1 && typeof value.type === 'string';
}

export interface GraphBlockLocation {
	sourcePath: string;
	startLine: number;
	endLine: number;
}

export type GraphBlockState = 'empty' | 'valid' | 'invalid';

export interface GraphBlockClassification {
	state: GraphBlockState;
	spec?: GraphSpec;
	error?: string;
}

export function classifyGraphBlockSource(
	source: string,
	settings?: Partial<MathGraphSettings>,
): GraphBlockClassification {
	const trimmed = source.trim();
	if (!trimmed) {
		return { state: 'empty' };
	}

	try {
		const parsed: unknown = JSON.parse(trimmed);
		if (!isGraphSpec(parsed)) {
			return { state: 'invalid', error: 'Graph block is missing required fields.' };
		}
		return { state: 'valid', spec: hydrateGraphSpec(parsed, settings) };
	} catch (err) {
		return {
			state: 'invalid',
			error: err instanceof Error ? err.message : 'Invalid graph JSON.',
		};
	}
}

export async function readNoteLines(app: App, sourcePath: string): Promise<string[] | null> {
	const file = app.vault.getAbstractFileByPath(sourcePath);
	if (!(file instanceof TFile)) {
		return null;
	}
	const content = await app.vault.read(file);
	return content.split('\n');
}

export function locateGraphBlockAtLine(
	lines: string[],
	sourcePath: string,
	anchorLine: number,
): GraphBlockLocation | null {
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim() !== '```graph') {
			continue;
		}

		let j = i + 1;
		while (j < lines.length && lines[j].trim() !== '```') {
			j++;
		}
		if (j >= lines.length) {
			continue;
		}

		if (anchorLine >= i && anchorLine <= j) {
			return { sourcePath, startLine: i, endLine: j };
		}
	}
	return null;
}

export function locateGraphBlockByBody(
	lines: string[],
	sourcePath: string,
	body: string,
): GraphBlockLocation | null {
	const target = body.trim();
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim() !== '```graph') {
			continue;
		}

		let j = i + 1;
		const bodyLines: string[] = [];
		while (j < lines.length && lines[j].trim() !== '```') {
			bodyLines.push(lines[j]);
			j++;
		}
		if (j >= lines.length) {
			continue;
		}

		if (bodyLines.join('\n').trim() === target) {
			return { sourcePath, startLine: i, endLine: j };
		}
	}
	return null;
}

export async function resolveGraphBlockLocation(
	app: App,
	ctx: MarkdownPostProcessorContext,
	source: string,
	el: HTMLElement,
): Promise<GraphBlockLocation | null> {
	const lines = await readNoteLines(app, ctx.sourcePath);
	if (!lines) {
		return null;
	}

	const section = ctx.getSectionInfo(el);
	if (section) {
		const byLine = locateGraphBlockAtLine(lines, ctx.sourcePath, section.lineStart);
		if (byLine) {
			return byLine;
		}
	}

	return locateGraphBlockByBody(lines, ctx.sourcePath, source);
}

export async function replaceGraphBlockBody(
	app: App,
	location: GraphBlockLocation,
	spec: GraphSpec,
): Promise<void> {
	const file = app.vault.getAbstractFileByPath(location.sourcePath);
	if (!(file instanceof TFile)) {
		throw new Error('Note not found.');
	}

	const lines = (await app.vault.read(file)).split('\n');
	const jsonLines = serializeGraphSpec(spec).split('\n');
	const replacement = ['```graph', ...jsonLines, '```'];

	const nextLines = [
		...lines.slice(0, location.startLine),
		...replacement,
		...lines.slice(location.endLine + 1),
	];
	await app.vault.modify(file, nextLines.join('\n'));
}

export async function clearGraphBlockBody(
	app: App,
	location: GraphBlockLocation,
): Promise<void> {
	const file = app.vault.getAbstractFileByPath(location.sourcePath);
	if (!(file instanceof TFile)) {
		throw new Error('Note not found.');
	}

	const lines = (await app.vault.read(file)).split('\n');
	const replacement = ['```graph', '```'];

	const nextLines = [
		...lines.slice(0, location.startLine),
		...replacement,
		...lines.slice(location.endLine + 1),
	];
	await app.vault.modify(file, nextLines.join('\n'));
}

export async function removeGraphBlock(
	app: App,
	location: GraphBlockLocation,
): Promise<void> {
	const file = app.vault.getAbstractFileByPath(location.sourcePath);
	if (!(file instanceof TFile)) {
		throw new Error('Note not found.');
	}

	const lines = (await app.vault.read(file)).split('\n');
	const nextLines = [
		...lines.slice(0, location.startLine),
		...lines.slice(location.endLine + 1),
	];
	await app.vault.modify(file, nextLines.join('\n'));
}

export async function insertGraphBlockAtCursor(app: App, spec: GraphSpec): Promise<void> {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) {
		throw new Error('Open a note to insert a graph.');
	}

	const editor = view.editor;
	const jsonLines = serializeGraphSpec(spec).split('\n');
	const fenced = ['```graph', ...jsonLines, '```'].join('\n');
	const cursor = editor.getCursor();
	const prefix = cursor.line === 0 && cursor.ch === 0 ? '' : '\n\n';
	editor.replaceRange(`${prefix}${fenced}\n`, cursor);
}
