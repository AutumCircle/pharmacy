import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const details = readFileSync('src/app/medicine/[name]/ProductDetailsClient.tsx', 'utf8');
const footer = readFileSync('src/components/Footer.tsx', 'utf8');
const footerConfig = readFileSync('src/config/site-footer.ts', 'utf8');

test('product detail uses image_url with eager loading and an error fallback', () => {
  assert.match(details, /product\.image_url && !imageFailed/);
  assert.match(details, /loading="eager"/);
  assert.match(details, /fetchPriority="high"/);
  assert.match(details, /onError=\{\(\) => setImageFailed\(true\)\}/);
});

test('footer contains only the approved contact data', () => {
  for (const value of ['Душанбе, ул. Айни 29', '446250077', '710500500', '715500500', '07:00–01:00', 'https://www.instagram.com/aptekavatan/']) {
    assert.ok(footerConfig.includes(value));
  }
  assert.doesNotMatch(footer, /Полезные ссылки|disclaimer|email/i);
  assert.match(footer, /rel="noopener noreferrer"/);
});
