import { formatTickLabel } from '../src/formatTickLabel';
import { fixTikzJaxSvgTickLabels } from '../render/svgTickLabelFix';
import { finalizeSvg } from '../render/svgPostProcess';

const cases: Array<[number, string]> = [
	[-6, '-6'],
	[-1.5, '-1.5'],
	[-0.5, '-0.5'],
	[-0, '0'],
	[0, '0'],
	[1.5, '1.5'],
];

for (const [value, expected] of cases) {
	const actual = formatTickLabel(value);
	if (actual !== expected) {
		console.error(`formatTickLabel(${value}) expected "${expected}", got "${actual}"`);
		process.exit(1);
	}
}

const brokenTickGroup = [
	'<g stroke="none" font-size="10">',
	'<text x="-26.316" y="45.856" font-family="cmsy10" transform="matrix(1 0 0 -1 19.927 35.878)">¡</text>',
	'<text x="-18.538" y="45.856" font-family="cmr10" transform="matrix(1 0 0 -1 19.927 35.878)">6</text>',
	'</g>',
].join('');

const fixedGroup = fixTikzJaxSvgTickLabels(brokenTickGroup);
if (!fixedGroup.includes('>-6<') || fixedGroup.includes('¡') || fixedGroup.includes('cmsy10')) {
	console.error('fixTikzJaxSvgTickLabels failed for grouped tick label:', fixedGroup);
	process.exit(1);
}

const decimalGroup = [
	'<g stroke="none" font-size="10">',
	'<text x="-26.316" y="45.856" font-family="cmsy10">¡</text>',
	'<text x="-18.538" y="45.856" font-family="cmr10">1</text>',
	'<text x="-10.76" y="45.856" font-family="cmr10">.</text>',
	'<text x="-5" y="45.856" font-family="cmr10">5</text>',
	'</g>',
].join('');

const fixedDecimal = fixTikzJaxSvgTickLabels(decimalGroup);
if (!fixedDecimal.includes('>-1.5<')) {
	console.error('fixTikzJaxSvgTickLabels failed for decimal tick label:', fixedDecimal);
	process.exit(1);
}

const unicodeMinus = '<text font-family="cmr10">−1.5</text>';
const fixedUnicode = finalizeSvg(unicodeMinus);
if (!fixedUnicode.includes('>-1.5<') || fixedUnicode.includes('−')) {
	console.error('finalizeSvg failed to normalize unicode minus:', fixedUnicode);
	process.exit(1);
}

console.log('All tick label tests passed.');
