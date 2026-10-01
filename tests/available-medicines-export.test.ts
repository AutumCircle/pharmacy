import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync('src/app/admin/medicines/page.tsx', 'utf8');
const route = readFileSync('src/app/api/admin/medicines/available-export/[format]/route.ts', 'utf8');

test('admin catalogue exposes xlsx and csv downloads for available medicines', () => {
  assert.match(page, /available-export\/xlsx/);
  assert.match(page, /available-export\/csv/);
  assert.match(page, /Скачать доступные \(\.xlsx\)/);
  assert.match(page, /Скачать доступные \(\.csv\)/);
});

test('download route requires an admin session and uses the request origin for links', () => {
  assert.match(route, /verifyAdminSession/);
  assert.match(route, /new URL\(request\.url\)\.origin/);
  assert.match(route, /Cache-Control': 'private, no-store'/);
});
