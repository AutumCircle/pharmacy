import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('standard product card does not render vendor or country text', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/ProductCard.tsx'), 'utf8');
  const renderedSection = source.slice(source.indexOf('return ('), source.lastIndexOf(');'));
  assert.doesNotMatch(renderedSection, /item\.(vendor|country)/);
});

test('medicine details still render vendor and country', () => {
  const source = readFileSync(join(process.cwd(), 'src/app/medicine/[name]/ProductDetailsClient.tsx'), 'utf8');
  assert.match(source, /product\.vendor/);
  assert.match(source, /product\.country/);
});
