import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
	console.error(`Release verification failed: ${message}`);
	process.exit(1);
}

function readJson(relativePath) {
	const filePath = path.join(root, relativePath);
	if (!fs.existsSync(filePath)) {
		fail(`Missing required file: ${relativePath}`);
	}
	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf8'));
	} catch (error) {
		fail(`Invalid JSON in ${relativePath}: ${error.message}`);
	}
}

const manifest = readJson('manifest.json');
const versions = readJson('versions.json');
const pkg = readJson('package.json');

const requiredManifestFields = [
	'id',
	'name',
	'version',
	'minAppVersion',
	'description',
	'author',
	'isDesktopOnly',
];

for (const field of requiredManifestFields) {
	if (manifest[field] === undefined || manifest[field] === null || manifest[field] === '') {
		fail(`manifest.json is missing required field "${field}".`);
	}
}

if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
	fail(`manifest.json version must be semver x.y.z (got "${manifest.version}").`);
}

if (manifest.description.length > 250) {
	fail(`manifest.json description must be 250 characters or fewer (got ${manifest.description.length}).`);
}

if (!manifest.description.trim().endsWith('.')) {
	fail('manifest.json description must end with a period.');
}

if (/^this is a plugin/i.test(manifest.description.trim())) {
	fail('manifest.json description should not start with "This is a plugin".');
}

if (manifest.authorUrl === '') {
	fail('Remove empty manifest.json authorUrl or set it to a valid URL.');
}

if (typeof manifest.isDesktopOnly !== 'boolean') {
	fail('manifest.json isDesktopOnly must be a boolean.');
}

if (versions[manifest.version] !== manifest.minAppVersion) {
	fail(
		`versions.json must map "${manifest.version}" to minAppVersion "${manifest.minAppVersion}" `
		+ `(got "${versions[manifest.version] ?? 'missing'}").`,
	);
}

if (pkg.version !== manifest.version) {
	fail(`package.json version "${pkg.version}" must match manifest.json version "${manifest.version}".`);
}

for (const file of ['README.md', 'LICENSE']) {
	if (!fs.existsSync(path.join(root, file))) {
		fail(`Missing required repository file: ${file}`);
	}
}

console.log('Release metadata verified.');
