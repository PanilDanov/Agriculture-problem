import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ignoredDirectories = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage', 'playwright-report',
  'test-results', '.vite', '.vercel', '.sites-runtime',
  '.runtime', '.cache', '__pycache__', 'data',
]);
const textExtensions = new Set([
  '.md', '.json', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.html',
  '.yml', '.yaml', '.py', '.svg', '.txt', '.sh', '.toml', '.xml', '.sql',
  '.csv', '.tsv', '.ini', '.cfg', '.conf',
]);
const cyrillic = /[\u0400-\u052f\u2de0-\u2dff\ua640-\ua69f]/u;
const violations = [];
let checkedFiles = 0;

function checkJson(value, filename) {
  if (typeof value === 'string' && cyrillic.test(value)) violations.push(filename);
  if (Array.isArray(value)) value.forEach((item) => checkJson(item, filename));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      checkJson(key, filename);
      checkJson(item, filename);
    }
  }
}

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name) && !entry.name.startsWith('.venv')) await visit(filename);
      continue;
    }
    if (!entry.isFile()) continue;
    if (cyrillic.test(entry.name)) violations.push(filename);
    if (!textExtensions.has(path.extname(filename)) && entry.name !== '.gitignore') continue;
    const content = await readFile(filename, 'utf8');
    checkedFiles += 1;
    if (cyrillic.test(content)) violations.push(filename);
    if (path.extname(filename) === '.json') checkJson(JSON.parse(content), filename);
  }
}

await visit(process.cwd());
if (violations.length) {
  process.stderr.write(`English-only content check failed:\n${[...new Set(violations)].join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`English-only content check passed (${checkedFiles} text files).\n`);
}
