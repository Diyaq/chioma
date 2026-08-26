#!/usr/bin/env node
/**
 * Adds the project's SPDX MIT license header to source files that are
 * missing one. Run with --check to verify headers are present without
 * writing (exit code 1 if any file is missing a header).
 *
 * Usage:
 *   node scripts/add-license-headers.mjs [--check]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECK_ONLY = process.argv.includes('--check');

const YEAR = 2026;
const HOLDER = 'caxton strange';

const HEADER_LINES = [
  `// SPDX-License-Identifier: MIT`,
  `// Copyright (c) ${YEAR} ${HOLDER}`,
];

const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  'target',
  'coverage',
  '.turbo',
  '.git',
]);

const TARGETS = [
  { dir: 'frontend', extensions: ['.ts', '.tsx'] },
  { dir: 'backend', extensions: ['.ts'] },
  { dir: 'contract', extensions: ['.rs'] },
];

const EXCLUDED_FILES = [/\.d\.ts$/, /api-generated\.ts$/];

function collectFiles(dir, extensions) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      results.push(...collectFiles(join(dir, entry.name), extensions));
      continue;
    }

    if (!extensions.includes(extname(entry.name))) continue;
    if (EXCLUDED_FILES.some((re) => re.test(entry.name))) continue;
    results.push(join(dir, entry.name));
  }

  return results;
}

/** Directive lines (and shebangs) that must stay the first line(s) of a file. */
function splitLeadingDirective(content) {
  const lines = content.split('\n');
  let idx = 0;

  if (lines[0]?.startsWith('#!')) {
    idx = 1;
  } else if (/^['"]use (client|server|strict)['"];?$/.test(lines[0]?.trim() ?? '')) {
    idx = 1;
  }
  // Rust inner attributes (`#![...]`) are legal anywhere before the first
  // item, so it's always safe to put the header before all of them rather
  // than risk splitting a contiguous attribute block.

  return {
    directive: lines.slice(0, idx).join('\n'),
    rest: lines.slice(idx).join('\n'),
  };
}

function hasHeader(content) {
  return content.includes('SPDX-License-Identifier');
}

async function main() {
  const files = TARGETS.flatMap(({ dir, extensions }) =>
    collectFiles(join(ROOT, dir), extensions),
  );

  const missing = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (hasHeader(content)) continue;

    missing.push(relative(ROOT, file));

    if (CHECK_ONLY) continue;

    const { directive, rest } = splitLeadingDirective(content);
    const header = HEADER_LINES.join('\n') + '\n\n';
    const newContent = directive
      ? `${directive}\n\n${header}${rest.replace(/^\n+/, '')}`
      : `${header}${rest}`;
    writeFileSync(file, newContent, 'utf8');
  }

  if (CHECK_ONLY) {
    if (missing.length > 0) {
      console.error(`${missing.length} file(s) missing a license header:`);
      for (const f of missing) console.error(`  ${f}`);
      process.exit(1);
    }
    console.log('All source files have a license header.');
    return;
  }

  console.log(`Added license headers to ${missing.length} file(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
