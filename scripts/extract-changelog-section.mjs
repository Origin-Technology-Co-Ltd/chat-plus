#!/usr/bin/env node
/**
 * Extract a Keep a Changelog section body for a version from CHANGELOG.md.
 * Usage: node scripts/extract-changelog-section.mjs <version> [path/to/CHANGELOG.md]
 * Version may be "0.1.0" or "v0.1.0". Prints section body to stdout; exits 1 if missing/empty.
 */
import fs from 'node:fs';
import path from 'node:path';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const rawVersion = process.argv[2];
const changelogPath = path.resolve(process.argv[3] || 'CHANGELOG.md');

if (!rawVersion) {
  console.error(
    'Usage: node scripts/extract-changelog-section.mjs <version> [CHANGELOG.md]',
  );
  process.exit(1);
}

const version = rawVersion.replace(/^v/i, '');
if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`Invalid version: ${rawVersion}`);
  process.exit(1);
}

if (!fs.existsSync(changelogPath)) {
  console.error(`Changelog not found: ${changelogPath}`);
  process.exit(1);
}

const text = fs.readFileSync(changelogPath, 'utf8');
const headingRe = new RegExp(
  `^## \\[${escapeRegExp(version)}\\](?:\\s+-\\s+[^\\n]+)?\\s*$`,
  'm',
);
const match = headingRe.exec(text);

if (!match) {
  console.error(
    `Missing CHANGELOG section ## [${version}] in ${changelogPath}`,
  );
  process.exit(1);
}

const afterHeading = text.slice(match.index + match[0].length);
const nextHeading = afterHeading.search(/^## \[/m);
const body = (
  nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading)
).trim();

if (!body) {
  console.error(`Empty CHANGELOG section for version ${version}`);
  process.exit(1);
}

process.stdout.write(`${body}\n`);
