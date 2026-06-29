import type { App } from 'obsidian';
import type MathGraphStudioPlugin from '../main';
import { clearGraphRenderCache } from './graphRenderCache';
import { captureScrollPosition, restoreScrollPosition } from './scrollPreserve';
import { getCurrentTheme } from './graphThemeColors';
import { isHTMLElement } from './domUtils';

export interface GraphRerenderOptions {
	preserveScale?: boolean;
	reason?: string;
}

type GraphRerenderHandler = (options?: GraphRerenderOptions) => void;

const graphRerenderHandlers = new WeakMap<HTMLElement, GraphRerenderHandler>();

const THEME_REFRESH_DEBOUNCE_MS = 100;

export function registerGraphRerenderHandler(el: HTMLElement, handler: GraphRerenderHandler): void {
	graphRerenderHandlers.set(el, handler);
}

export function rerenderGraphContainer(
	container: HTMLElement,
	options?: GraphRerenderOptions,
): void {
	const root = container.closest('.mathgraph-processor-root');
	if (isHTMLElement(root)) {
		graphRerenderHandlers.get(root)?.(options);
	}
}

function findMountedGraphRoots(app: App): HTMLElement[] {
	const seen = new Set<HTMLElement>();
	const results: HTMLElement[] = [];

	app.workspace.iterateAllLeaves(leaf => {
		const container = leaf.view?.containerEl;
		if (!container?.isConnected) {
			return;
		}

		for (const root of Array.from(container.querySelectorAll('.mathgraph-processor-root'))) {
			if (!isHTMLElement(root)) {
				continue;
			}
			if (!root.isConnected || !root.querySelector('.mathgraph-rendered-container')) {
				continue;
			}
			if (seen.has(root)) {
				continue;
			}
			seen.add(root);
			results.push(root);
		}
	});

	return results;
}

export function refreshVisibleGraphsForThemeChange(app: App): void {
	const snapshot = captureScrollPosition(app);
	const roots = findMountedGraphRoots(app);

	for (const root of roots) {
		graphRerenderHandlers.get(root)?.({
			preserveScale: true,
			reason: 'theme-change',
		});
	}

	restoreScrollPosition(app, snapshot);
}

export function createThemeWatcher(plugin: MathGraphStudioPlugin): {
	disconnect: () => void;
} {
	let currentTheme = getCurrentTheme();
	let refreshTimer: number | null = null;
	const doc = plugin.app.workspace.containerEl.ownerDocument;

	const scheduleRefresh = () => {
		if (refreshTimer !== null) {
			window.clearTimeout(refreshTimer);
		}
		refreshTimer = window.setTimeout(() => {
			refreshTimer = null;
			plugin.refreshVisibleGraphsForThemeChange();
		}, THEME_REFRESH_DEBOUNCE_MS);
	};

	const onMutation = () => {
		const nextTheme = getCurrentTheme();
		if (nextTheme === currentTheme) {
			return;
		}
		currentTheme = nextTheme;
		plugin.currentTheme = nextTheme;
		plugin.renderer.clearCache();
		clearGraphRenderCache();
		plugin.notifyThemeChanged(nextTheme);
		scheduleRefresh();
	};

	const observer = new MutationObserver(onMutation);
	const targets = [doc.body, doc.documentElement];
	for (const target of targets) {
		observer.observe(target, { attributes: true, attributeFilter: ['class'] });
	}

	return {
		disconnect: () => {
			if (refreshTimer !== null) {
				window.clearTimeout(refreshTimer);
			}
			observer.disconnect();
		},
	};
}
