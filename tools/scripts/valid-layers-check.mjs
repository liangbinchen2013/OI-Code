#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parser } from 'typescript-eslint';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// 分层规则来自 AGENTS.md 第 2.1 节：Code -> Workbench -> Editor -> Platform -> Base，只允许单向依赖
const LAYER_RULES = {
  base: [],
  platform: ['base'],
  editor: ['base', 'platform'],
  workbench: ['base', 'platform', 'editor'],
  code: ['base', 'platform', 'editor', 'workbench'],
  // 扩展层规则尚未在 AGENTS.md 中定义，暂按最小权限（base + platform）执行，需人类确认后修订
  extension: ['base', 'platform'],
};

const PACKAGE_LAYERS = {
  '@oi/base': 'base',
  '@oi/platform': 'platform',
  '@oi/editor': 'editor',
  '@oi/workbench': 'workbench',
  '@oi/desktop': 'code',
};

const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.nx',
  'test-results',
  'playwright-report',
]);

function toPosix(path) {
  return path.split(sep).join('/');
}

function layerOfPath(absPath) {
  const rel = toPosix(relative(workspaceRoot, absPath));
  if (rel.startsWith('libs/extensions/')) return 'extension';
  if (rel.startsWith('libs/base/')) return 'base';
  if (rel.startsWith('libs/platform/')) return 'platform';
  if (rel.startsWith('libs/editor/')) return 'editor';
  if (rel.startsWith('libs/workbench/')) return 'workbench';
  if (rel.startsWith('apps/')) return 'code';
  return undefined;
}

function isAllowed(sourceLayer, targetLayer) {
  return sourceLayer === targetLayer || LAYER_RULES[sourceLayer].includes(targetLayer);
}

function walkTree(node, visitor) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visitor(node);
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) walkTree(item, visitor);
    } else if (value && typeof value === 'object' && typeof value.type === 'string') {
      walkTree(value, visitor);
    }
  }
}

function parseSpecifiers(code, filePath) {
  const { ast } = parser.parseForESLint(code, {
    filePath,
    ecmaVersion: 'latest',
    sourceType: 'module',
  });
  const specifiers = [];
  walkTree(ast, (node) => {
    const collect = (sourceNode) => {
      if (sourceNode && typeof sourceNode.value === 'string') {
        specifiers.push({ value: sourceNode.value, line: sourceNode.loc.start.line });
      }
    };
    if (
      node.type === 'ImportDeclaration' ||
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportAllDeclaration'
    ) {
      collect(node.source);
    }
    if (node.type === 'ImportExpression') {
      collect(node.source);
    }
    if (
      node.type === 'CallExpression' &&
      node.callee &&
      (node.callee.type === 'Import' ||
        (node.callee.type === 'Identifier' && node.callee.name === 'require'))
    ) {
      collect(node.arguments && node.arguments[0]);
    }
  });
  return specifiers;
}

function resolveSpecifier(specifier, fromFile) {
  if (specifier.startsWith('@oi/')) {
    const packageName = specifier.split('/').slice(0, 2).join('/');
    const layer = PACKAGE_LAYERS[packageName];
    return layer ? { layer, packageName } : { unknownPackage: packageName };
  }
  if (specifier.startsWith('.')) {
    const absPath = resolve(dirname(fromFile), specifier);
    const layer = layerOfPath(absPath);
    return layer ? { layer, packageName: toPosix(relative(workspaceRoot, absPath)) } : undefined;
  }
  return undefined;
}

function collectSourceFiles(dir, files) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      collectSourceFiles(join(dir, entry.name), files);
    } else if (/\.(ts|tsx|mts|cts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(join(dir, entry.name));
    }
  }
}

function collectPackageJsonFiles(dir, files) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      collectPackageJsonFiles(join(dir, entry.name), files);
    } else if (entry.name === 'package.json') {
      files.push(join(dir, entry.name));
    }
  }
}

const violations = [];
const scannedFiles = [];

function report(file, line, sourceLayer, targetLayer, specifier) {
  const location = `${toPosix(relative(workspaceRoot, file))}${line ? `:${line}` : ''}`;
  violations.push(`${location}  [${sourceLayer}] 不允许依赖 [${targetLayer}] -> "${specifier}"`);
}

for (const rootName of ['libs', 'apps']) {
  collectSourceFiles(join(workspaceRoot, rootName), scannedFiles);
}

for (const file of scannedFiles) {
  const sourceLayer = layerOfPath(file);
  if (!sourceLayer) continue;
  let specifiers;
  try {
    specifiers = parseSpecifiers(readFileSync(file, 'utf8'), file);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    violations.push(`${toPosix(relative(workspaceRoot, file))}  解析失败：${message}`);
    continue;
  }
  for (const { value, line } of specifiers) {
    const resolved = resolveSpecifier(value, file);
    if (!resolved) continue;
    if (resolved.unknownPackage) {
      violations.push(
        `${toPosix(relative(workspaceRoot, file))}:${line}  未知工作区包 "${resolved.unknownPackage}"`,
      );
      continue;
    }
    if (!isAllowed(sourceLayer, resolved.layer)) {
      report(file, line, sourceLayer, resolved.layer, value);
    }
  }
}

const packageJsonFiles = [];
for (const rootName of ['libs', 'apps']) {
  collectPackageJsonFiles(join(workspaceRoot, rootName), packageJsonFiles);
}

for (const packageJsonPath of packageJsonFiles) {
  const sourceLayer = layerOfPath(dirname(packageJsonPath));
  if (!sourceLayer) continue;
  const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const declared = { ...manifest.dependencies, ...manifest.peerDependencies };
  for (const packageName of Object.keys(declared)) {
    const targetLayer = PACKAGE_LAYERS[packageName];
    if (!targetLayer) continue;
    if (!isAllowed(sourceLayer, targetLayer)) {
      report(packageJsonPath, 0, sourceLayer, targetLayer, packageName);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`分层校验失败：发现 ${violations.length} 处违规依赖\n`);
  for (const violation of violations) {
    process.stderr.write(`  ${violation}\n`);
  }
  process.exit(1);
}

process.stdout.write(
  `分层校验通过：扫描 ${scannedFiles.length} 个源文件、${packageJsonFiles.length} 个包清单，未发现违规依赖\n`,
);
