type ObsidianWindow = Window & {
	instanceOf(value: unknown, ctor: abstract new (...args: never) => unknown): boolean;
};

function asObsidianWindow(win: Window): ObsidianWindow {
	return win as ObsidianWindow;
}

export function activeWindowFor(el: Element): Window {
	return el.ownerDocument.defaultView ?? window;
}

export function isHTMLElement(el: unknown, win?: Window): el is HTMLElement {
	if (typeof el !== 'object' || el === null) {
		return false;
	}
	const activeWindow = asObsidianWindow(win ?? (el instanceof Element ? activeWindowFor(el) : window));
	if (typeof activeWindow.instanceOf === 'function') {
		return activeWindow.instanceOf(el, HTMLElement);
	}
	return el instanceof HTMLElement;
}

export function isHTMLImageElement(el: unknown, win?: Window): el is HTMLImageElement {
	if (typeof el !== 'object' || el === null) {
		return false;
	}
	const activeWindow = asObsidianWindow(win ?? (el instanceof Element ? activeWindowFor(el) : window));
	if (typeof activeWindow.instanceOf === 'function') {
		return activeWindow.instanceOf(el, HTMLImageElement);
	}
	return el instanceof HTMLImageElement;
}

export function isSVGSVGElement(el: unknown, win?: Window): el is SVGSVGElement {
	if (typeof el !== 'object' || el === null) {
		return false;
	}
	const activeWindow = asObsidianWindow(win ?? (el instanceof Element ? activeWindowFor(el) : window));
	if (typeof activeWindow.instanceOf === 'function') {
		return activeWindow.instanceOf(el, SVGSVGElement);
	}
	return el instanceof SVGSVGElement;
}
