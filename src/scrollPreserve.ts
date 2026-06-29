import type { App } from 'obsidian';

export interface ScrollSnapshot {
	windowY: number;
	containers: Array<{ element: Element; top: number }>;
}

function scrollContainerCandidates(doc: Document): Element[] {
	const selectors = [
		'.markdown-reading-view .markdown-preview-view',
		'.markdown-reading-view',
		'.workspace-leaf-content .view-content',
		'.cm-scroller',
	];
	const seen = new Set<Element>();
	const results: Element[] = [];
	for (const selector of selectors) {
		for (const element of Array.from(doc.querySelectorAll(selector))) {
			if (seen.has(element)) {
				continue;
			}
			seen.add(element);
			results.push(element);
		}
	}
	return results;
}

export function captureScrollPosition(app: App): ScrollSnapshot {
	const leaf = app.workspace.getMostRecentLeaf();
	const doc = leaf?.view?.containerEl.ownerDocument ?? document;
	const containers = scrollContainerCandidates(doc)
		.filter(element => element.scrollHeight > element.clientHeight + 1)
		.map(element => ({ element, top: element.scrollTop }));

	return {
		windowY: window.scrollY,
		containers,
	};
}

export function restoreScrollPosition(_app: App, snapshot: ScrollSnapshot): void {
	const apply = () => {
		window.scrollTo({ top: snapshot.windowY });
		for (const { element, top } of snapshot.containers) {
			element.scrollTop = top;
		}
	};

	requestAnimationFrame(() => {
		apply();
		requestAnimationFrame(apply);
	});
}

export async function withPreservedScroll<T>(
	app: App,
	action: () => Promise<T>,
): Promise<T> {
	const snapshot = captureScrollPosition(app);
	try {
		return await action();
	} finally {
		restoreScrollPosition(app, snapshot);
	}
}
