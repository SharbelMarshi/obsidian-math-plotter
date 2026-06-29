import { formatDisplayScaleLabel, isGraph3dView, resolveDisplayScale } from './graphSize';
import type { GraphSpec } from './graphSpec';

const BASE_WIDTH_DATA_ATTR = 'data-mathgraph-base-width';
const FALLBACK_BASE_WIDTH_2D = 540;
const FALLBACK_BASE_WIDTH_3D = 660;
const MAX_NORMAL_BASE_WIDTH_2D = 575;
const MAX_NORMAL_BASE_WIDTH_3D = 700;
const MIN_RELIABLE_IMAGE_WIDTH = 200;
const MAX_RELIABLE_MEASURED_WIDTH = 1200;
const MIN_VALID_MEASURED_WIDTH = 250;

/** Resolve a comfortable 100% display base width from measured SVG/image width. */
export function getGraphBaseWidthPx(spec: GraphSpec, measuredNaturalWidth: number | null): number {
	const is3D = isGraph3dView(spec);
	const fallback = is3D ? FALLBACK_BASE_WIDTH_3D : FALLBACK_BASE_WIDTH_2D;
	const maxNormal = is3D ? MAX_NORMAL_BASE_WIDTH_3D : MAX_NORMAL_BASE_WIDTH_2D;

	if (
		!measuredNaturalWidth
		|| measuredNaturalWidth < MIN_VALID_MEASURED_WIDTH
		|| measuredNaturalWidth > MAX_RELIABLE_MEASURED_WIDTH
	) {
		return fallback;
	}

	return Math.min(measuredNaturalWidth, maxNormal);
}

function readStoredBaseWidth(inner: HTMLElement): number | null {
	const stored = inner.getAttribute(BASE_WIDTH_DATA_ATTR);
	if (!stored) {
		return null;
	}
	const parsed = Number.parseFloat(stored);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function storeBaseWidth(inner: HTMLElement, baseWidth: number): void {
	inner.setAttribute(BASE_WIDTH_DATA_ATTR, String(baseWidth));
}

function parseSvgLength(raw: string): number | null {
	const trimmed = raw.trim();
	const match = trimmed.match(/^([\d.]+)\s*(pt|px|cm|mm|in)?$/i);
	if (!match) {
		return null;
	}

	const value = Number.parseFloat(match[1]);
	if (!Number.isFinite(value) || value <= 0) {
		return null;
	}

	const unit = (match[2] ?? 'px').toLowerCase();
	switch (unit) {
		case 'pt':
			return value * (96 / 72);
		case 'cm':
			return value * (96 / 2.54);
		case 'mm':
			return value * (96 / 25.4);
		case 'in':
			return value * 96;
		default:
			return value;
	}
}

export function parseSvgWidthFromText(svgText: string): number | null {
	const widthAttr = svgText.match(/\bwidth="([^"]+)"/);
	if (widthAttr) {
		const parsed = parseSvgLength(widthAttr[1]);
		if (parsed && parsed > 0) {
			return parsed;
		}
	}

	const viewBox = svgText.match(/viewBox="([^"]+)"/);
	if (viewBox) {
		const parts = viewBox[1].trim().split(/\s+/);
		if (parts.length >= 4) {
			const width = Number.parseFloat(parts[2]);
			if (Number.isFinite(width) && width > 0) {
				return width;
			}
		}
	}

	return null;
}

function measureNaturalImageWidth(img: HTMLImageElement, svgText?: string): number | null {
	const parsedSvg = svgText ? parseSvgWidthFromText(svgText) : null;

	if (parsedSvg && parsedSvg >= MIN_RELIABLE_IMAGE_WIDTH) {
		return parsedSvg;
	}

	if (img.naturalWidth >= MIN_RELIABLE_IMAGE_WIDTH) {
		return img.naturalWidth;
	}

	if (parsedSvg && parsedSvg > 0) {
		return parsedSvg;
	}

	if (img.naturalWidth > 0) {
		return img.naturalWidth;
	}

	return null;
}

export function measureRenderedGraphBaseWidth(
	inner: HTMLElement,
	spec: GraphSpec,
	svgText?: string,
): number {
	const stored = readStoredBaseWidth(inner);
	if (stored !== null) {
		return getGraphBaseWidthPx(spec, stored);
	}

	let measured: number | null = null;
	const media = inner.querySelector('img, svg');

	if (media instanceof HTMLImageElement) {
		measured = measureNaturalImageWidth(media, svgText);
	}

	if (measured === null && media instanceof SVGSVGElement) {
		const rendered = media.getBoundingClientRect().width;
		if (rendered >= MIN_RELIABLE_IMAGE_WIDTH) {
			measured = rendered;
		}
	}

	if (measured === null && svgText) {
		measured = parseSvgWidthFromText(svgText);
	}

	return getGraphBaseWidthPx(spec, measured);
}

function updateOverflowState(container: HTMLElement, scaledWidth: number): void {
	const scroll = container.querySelector('.mathgraph-graph-scroll');
	if (!(scroll instanceof HTMLElement)) {
		return;
	}

	const containerWidth = scroll.clientWidth;
	scroll.classList.toggle('mathgraph-overflowing', scaledWidth > containerWidth + 1);
}

function updateScaleLabel(container: HTMLElement, scale: number): void {
	const label = container.querySelector('.mathgraph-scale-label');
	if (label) {
		label.setText(formatDisplayScaleLabel(scale));
	}
}

export function applyRenderedGraphLayoutScale(
	container: HTMLElement,
	spec: GraphSpec,
	options?: { remeasure?: boolean; svgText?: string },
): void {
	const inner = container.querySelector('.mathgraph-rendered-inner');
	if (!(inner instanceof HTMLElement)) {
		return;
	}

	const scale = resolveDisplayScale(spec);

	if (options?.remeasure) {
		inner.removeAttribute(BASE_WIDTH_DATA_ATTR);
	}

	const baseWidth = measureRenderedGraphBaseWidth(inner, spec, options?.svgText);

	if (baseWidth <= 0) {
		inner.style.removeProperty('--mathgraph-rendered-width');
		updateScaleLabel(container, scale);
		updateOverflowState(container, 0);
		return;
	}

	storeBaseWidth(inner, baseWidth);
	const scaledWidth = baseWidth * scale;
	inner.style.setProperty('--mathgraph-rendered-width', `${scaledWidth}px`);
	updateScaleLabel(container, scale);
	updateOverflowState(container, scaledWidth);
}

export function bindRenderedGraphLayoutScale(
	container: HTMLElement,
	spec: GraphSpec,
	svgText?: string,
): void {
	const inner = container.querySelector('.mathgraph-rendered-inner');
	if (!(inner instanceof HTMLElement)) {
		return;
	}

	const apply = () => {
		applyRenderedGraphLayoutScale(container, spec, { remeasure: true, svgText });
	};

	const media = inner.querySelector('img, svg');
	if (media instanceof HTMLImageElement) {
		if (media.complete) {
			apply();
		} else {
			media.addEventListener('load', apply, { once: true });
			media.addEventListener('error', apply, { once: true });
		}
	} else {
		apply();
	}

	const scroll = container.querySelector('.mathgraph-graph-scroll');
	if (scroll instanceof HTMLElement && typeof ResizeObserver !== 'undefined') {
		const observer = new ResizeObserver(() => {
			const stored = readStoredBaseWidth(inner);
			if (stored === null) {
				return;
			}
			const scale = resolveDisplayScale(spec);
			updateOverflowState(container, stored * scale);
		});
		observer.observe(scroll);
	}
}
