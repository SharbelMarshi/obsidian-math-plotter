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
	const doc = leaf?.view?.containerEl.ownerDocument ?? app.workspace.containerEl.ownerDocument;
	const activeWindow = doc.defaultView ?? window;
	const containers = scrollContainerCandidates(doc)
		.filter(element => element.scrollHeight > element.clientHeight + 1)
		.map(element => ({ element, top: element.scrollTop }));

	return {
		windowY: activeWindow.scrollY,
		containers,
	};
}

export function restoreScrollPosition(app: App, snapshot: ScrollSnapshot): void {
	const doc = app.workspace.containerEl.ownerDocument;
	const activeWindow = doc.defaultView ?? window;
	const apply = () => {
		activeWindow.scrollTo({ top: snapshot.windowY });
		for (const { element, top } of snapshot.containers) {
			element.scrollTop = top;
		}
	};

	activeWindow.requestAnimationFrame(() => {
		apply();
		activeWindow.requestAnimationFrame(apply);
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
