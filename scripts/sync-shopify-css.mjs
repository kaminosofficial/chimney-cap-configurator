import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(projectRoot, 'src', 'styles', 'globals.css');
const outputPath = path.join(projectRoot, 'src', 'styles', 'globals-scoped.css');
const ROOT_SELECTOR = '.chase-cover-configurator-root';

function scopeSelector(selector) {
  const trimmed = selector.trim();
  if (!trimmed) return null;

  if (trimmed === ':root' || trimmed === 'html' || trimmed === 'body' || trimmed === '#root') {
    return ROOT_SELECTOR;
  }

  if (trimmed.startsWith(ROOT_SELECTOR)) {
    return trimmed;
  }

  if (trimmed.startsWith('html ') || trimmed.startsWith('body ') || trimmed.startsWith('#root ')) {
    return trimmed.replace(/^(html|body|#root)\b/, ROOT_SELECTOR);
  }

  return `${ROOT_SELECTOR} ${trimmed}`;
}

const sourceCss = await fs.readFile(sourcePath, 'utf8');
const root = postcss.parse(sourceCss);

root.walkAtRules('import', atRule => {
  atRule.remove();
});

root.walkRules(rule => {
  if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name || '')) {
    return;
  }

  if (!rule.selectors) return;

  const scopedSelectors = rule.selectors
    .map(scopeSelector)
    .filter(Boolean);

  rule.selectors = [...new Set(scopedSelectors)];
});

const outputCss = `/* Generated from src/styles/globals.css by scripts/sync-shopify-css.mjs. */\n\n${root.toString()}\n`;
await fs.writeFile(outputPath, outputCss);
