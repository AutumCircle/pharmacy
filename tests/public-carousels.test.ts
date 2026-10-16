import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { toPublicCarouselsPayload } from '../src/lib/public-carousels.ts';

const PRODUCT_KEYS = ['medicine_id', 'medicine_name', 'selling_unit_price', 'currency', 'in_stock', 'image_url', 'sort_order'];
const CAROUSEL_KEYS = ['slug', 'title', 'sort_order', 'products'];

function product(id: number, sortOrder: number, extra: Record<string, unknown> = {}) {
  return {
    medicine_id: id,
    medicine_name: `Товар ${id}`,
    selling_unit_price: 25 + id,
    currency: 'TJS' as const,
    country: 'Таджикистан',
    vendor: 'Vendor',
    in_stock: id % 2 === 0,
    catalog_updated_at: '2026-10-01T10:00:00Z',
    image_url: id === 2 ? null : `https://cdn.example.com/${id}.jpg`,
    sort_order: sortOrder,
    ...extra,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fixture: any[] = [
  {
    slug: 'items-of-the-day',
    title: 'Товары дня',
    sort_order: 10,
    is_active: true,
    id: 7,
    products: [
      product(3, 30, { price: 10, base_price: 9, profit: 1, is_active: true, future_field: 'x' }),
      product(1, 10),
      product(2, 20),
    ],
  },
  { slug: 'empty', title: 'Пусто', sort_order: 15, products: [] },
  { slug: 'vitamins', title: 'Витамины', sort_order: 20, products: [product(4, 1)] },
];

test('mapper copies only whitelisted carousel and product keys', () => {
  const payload = toPublicCarouselsPayload(fixture);
  assert.deepEqual(Object.keys(payload), ['carousels']);
  for (const carousel of payload.carousels) {
    assert.deepEqual(Object.keys(carousel), CAROUSEL_KEYS);
    for (const item of carousel.products) {
      assert.deepEqual(Object.keys(item), PRODUCT_KEYS);
      for (const forbidden of ['price', 'country', 'vendor', 'catalog_updated_at', 'base_price', 'profit', 'is_active', 'future_field']) {
        assert.ok(!(forbidden in item), `${forbidden} must not leak`);
      }
    }
  }
});

test('mapper preserves upstream order, values, null image and integer TJS price', () => {
  const payload = toPublicCarouselsPayload(fixture);
  assert.deepEqual(payload.carousels.map((c) => c.slug), ['items-of-the-day', 'vitamins']);
  const first = payload.carousels[0];
  assert.equal(first.title, 'Товары дня');
  assert.equal(first.sort_order, 10);
  assert.deepEqual(first.products.map((p) => p.medicine_id), [3, 1, 2]);
  assert.deepEqual(first.products.map((p) => p.sort_order), [30, 10, 20]);
  assert.deepEqual(first.products[1], {
    medicine_id: 1,
    medicine_name: 'Товар 1',
    selling_unit_price: 26,
    currency: 'TJS',
    in_stock: false,
    image_url: 'https://cdn.example.com/1.jpg',
    sort_order: 10,
  });
  assert.equal(first.products[2].image_url, null);
  for (const carousel of payload.carousels) {
    for (const item of carousel.products) {
      assert.ok(Number.isInteger(item.selling_unit_price));
      assert.equal(item.currency, 'TJS');
      assert.equal(typeof item.in_stock, 'boolean');
    }
  }
});

test('carousels without products are omitted; empty inputs give an empty array', () => {
  assert.ok(!toPublicCarouselsPayload(fixture).carousels.some((c) => c.slug === 'empty'));
  assert.deepEqual(toPublicCarouselsPayload([]), { carousels: [] });
  assert.deepEqual(
    toPublicCarouselsPayload([
      { slug: 'a', title: 'A', sort_order: 1, products: [] },
      { slug: 'b', title: 'B', sort_order: 2, products: [] },
    ]),
    { carousels: [] },
  );
  assert.ok(Array.isArray(toPublicCarouselsPayload([]).carousels));
});

const route = readFileSync('src/app/api/product-carousels/route.ts', 'utf8');
const mapper = readFileSync('src/lib/public-carousels.ts', 'utf8');
const proxy = readFileSync('src/proxy.ts', 'utf8');

test('route calls the server helper, is dynamic and caches success briefly', () => {
  assert.match(route, /getPublicProductCarousels\(\)/);
  assert.match(route, /export const dynamic = 'force-dynamic'/);
  assert.match(route, /export async function GET\(/);
  assert.doesNotMatch(route, /export (async )?function (POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/);
  assert.doesNotMatch(route, /export const revalidate/);
  assert.match(route, /public, s-maxage=60, stale-while-revalidate=300/);
});

test('route returns a fixed 503 error without upstream details', () => {
  assert.match(route, /status: 503/);
  assert.match(route, /'Cache-Control': 'no-store'/);
  assert.match(route, /'Retry-After': '30'/);
  assert.match(route, /CAROUSELS_UNAVAILABLE/);
  assert.ok(route.includes('Секции товаров временно недоступны.'));
  assert.doesNotMatch(route, /apiRouteError/);
  assert.doesNotMatch(route, /error\.message/);
  assert.doesNotMatch(route, /process\.env/);
});

test('route and mapper expose no credentials and add no CORS', () => {
  for (const source of [route, mapper]) {
    assert.doesNotMatch(source, /NEXT_PUBLIC_/);
    assert.doesNotMatch(source, /x-api-key/i);
    assert.doesNotMatch(source, /API_KEY/);
    assert.doesNotMatch(source, /Access-Control-Allow-Origin/i);
  }
  assert.doesNotMatch(mapper, /import ['"]server-only['"]|from ['"]next/);
  assert.doesNotMatch(mapper, /^import (?!type )/m);
});

test('proxy matcher stays limited to admin and staff, so /api is anonymous', () => {
  assert.match(proxy, /matcher: \['\/admin\/:path\*', '\/staff\/:path\*'\]/);
  assert.doesNotMatch(proxy, /matcher:[^\]]*\/api/);
});
