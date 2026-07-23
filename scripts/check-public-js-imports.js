import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagesDir = path.join(projectRoot, 'src', 'pages');
const publicDir = path.join(projectRoot, 'public');
const importPattern =
  /\bimport\s*\{([\s\S]*?)\}\s*from\s*(['"])(\/js\/[^'"]+\.js)\2/g;
const identifierPattern = /^[A-Za-z_$][\w$]*$/;

async function findAstroFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return findAstroFiles(entryPath);
      return entry.isFile() && entry.name.endsWith('.astro') ? [entryPath] : [];
    }),
  );
  return files.flat();
}

function maskCommentsAndStrings(source) {
  let result = '';
  let state = 'code';

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (state === 'code') {
      if (char === '/' && next === '/') {
        result += '  ';
        index += 1;
        state = 'line-comment';
      } else if (char === '/' && next === '*') {
        result += '  ';
        index += 1;
        state = 'block-comment';
      } else if (char === "'" || char === '"' || char === '`') {
        result += ' ';
        state = char;
      } else {
        result += char;
      }
    } else if (state === 'line-comment') {
      if (char === '\n') {
        result += '\n';
        state = 'code';
      } else {
        result += ' ';
      }
    } else if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        result += '  ';
        index += 1;
        state = 'code';
      } else {
        result += char === '\n' ? '\n' : ' ';
      }
    } else if (char === '\\') {
      result += ' ';
      if (next !== undefined) {
        result += next === '\n' ? '\n' : ' ';
        index += 1;
      }
    } else if (char === state) {
      result += ' ';
      state = 'code';
    } else {
      result += char === '\n' ? '\n' : ' ';
    }
  }

  return result;
}

function getNamedExports(source) {
  const code = maskCommentsAndStrings(source);
  const exports = new Set();
  const declarationPattern =
    /^\s*export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z_$][\w$]*)/gm;
  const exportListPattern = /^\s*export\s*\{([\s\S]*?)\}/gm;

  for (const match of code.matchAll(declarationPattern)) {
    exports.add(match[1]);
  }

  for (const match of code.matchAll(exportListPattern)) {
    for (const item of match[1].split(',')) {
      const parts = item.trim().split(/\s+as\s+/);
      const exportedName = parts.at(-1)?.trim();
      if (exportedName && identifierPattern.test(exportedName)) {
        exports.add(exportedName);
      }
    }
  }

  return exports;
}

function getImportedNames(clause) {
  const withoutComments = clause
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n\r]*/g, ' ');

  return withoutComments.split(',').flatMap((item) => {
    const importedName = item.trim().split(/\s+as\s+/)[0]?.trim();
    return importedName && identifierPattern.test(importedName) ? [importedName] : [];
  });
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

const errors = [];
const exportCache = new Map();
const astroFiles = await findAstroFiles(pagesDir);

for (const astroFile of astroFiles) {
  const source = await readFile(astroFile, 'utf8');

  for (const match of source.matchAll(importPattern)) {
    const [, importClause, , publicSpecifier] = match;
    const targetFile = path.resolve(publicDir, `.${publicSpecifier}`);
    const relativeTarget = path.relative(publicDir, targetFile);
    const location = `${path.relative(projectRoot, astroFile)}:${lineNumberAt(source, match.index)}`;

    if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
      errors.push(`${location} invalid public path "${publicSpecifier}"`);
      continue;
    }

    let namedExports = exportCache.get(targetFile);
    if (!namedExports) {
      try {
        namedExports = getNamedExports(await readFile(targetFile, 'utf8'));
        exportCache.set(targetFile, namedExports);
      } catch (error) {
        if (error.code === 'ENOENT') {
          errors.push(`${location} cannot find ${path.relative(projectRoot, targetFile)}`);
          continue;
        }
        throw error;
      }
    }

    for (const importedName of getImportedNames(importClause)) {
      if (!namedExports.has(importedName)) {
        errors.push(
          `${location} "${publicSpecifier}" does not export "${importedName}"`,
        );
      }
    }
  }
}

if (errors.length > 0) {
  console.error('Public JavaScript import check failed:');
  for (const error of errors) console.error(`  ✗ ${error}`);
  process.exitCode = 1;
} else {
  console.log('✓ all public/js imports resolved');
}
