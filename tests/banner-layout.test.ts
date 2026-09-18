import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { bannerDimensions, containImage } from '../src/lib/banner-image.ts';
import { clamp, compositionField, elementLayout, imageLayout } from '../src/lib/banner-layout.ts';

const banner = {
  object_position_x: 30, object_position_y: 40, image_scale: 120,
  title_x: 8, title_y: 12, title_width: 70, title_scale: 100,
  mobile_override: true, mobile_image_x: 60, mobile_image_y: 70, mobile_image_scale: 90,
  mobile_title_x: 5, mobile_title_y: 18, mobile_title_width: 88, mobile_title_scale: 110,
} as never;

test('legacy image crop settings do not affect full-image rendering on either device', () => {
  assert.deepEqual(imageLayout(banner, 'desktop'), { x: 50, y: 50, scale: 100 });
  assert.deepEqual(imageLayout(banner, 'mobile'), { x: 50, y: 50, scale: 100 });
  assert.deepEqual(elementLayout(banner, 'title', 'mobile'), { x: 5, y: 18, width: 88, scale: 110 });
});

test('uploads fit exact dimensions without cropping or distortion', () => {
  for (const size of Object.values(bannerDimensions)) {
    for (const [width, height] of [[1513, 900], [900, 1513], [1500, 1000], [100, 100]]) {
      const fit = containImage(width, height, size.width, size.height);
      assert.ok(fit.x >= 0 && fit.y >= 0);
      assert.ok(fit.x + fit.width <= size.width + 0.00001);
      assert.ok(fit.y + fit.height <= size.height + 0.00001);
      assert.ok(Math.abs(fit.width / fit.height - width / height) < 0.00001);
    }
  }
  assert.throws(() => containImage(0, 100, 1500, 1000));
  assert.deepEqual(containImage(1500, 1000, 1500, 1000), { x: 0, y: 0, width: 1500, height: 1000 });
});

test('mobile banner is independent and preview does not add safe zones or font overrides', () => {
  const hero = readFileSync(new URL('../src/components/HeroBanners.tsx', import.meta.url), 'utf8');
  const editor = readFileSync(new URL('../src/app/admin/banners/[slot]/BannerEditorClient.tsx', import.meta.url), 'utf8');
  const renderer = readFileSync(new URL('../src/components/BannerRenderer.tsx', import.meta.url), 'utf8');
  assert.match(hero, /const mobile = banner\('mobile'\)/);
  assert.match(hero, /PublicBanner banner=\{mobile\}/);
  assert.doesNotMatch(hero, /hero-mobile-side-track/);
  assert.doesNotMatch(editor, /setPreviewMode|showSafeRegion/);
  assert.doesNotMatch(renderer, /showSafeRegion/);
  assert.match(renderer, /const mobile = desktop/);
});

test('composition helpers clamp values and map fields without pixels', () => {
  assert.equal(clamp(140, 0, 100), 100);
  assert.equal(clamp(-12, 0, 100), 0);
  assert.equal(compositionField('title', 'x', 'mobile', true), 'mobile_title_x');
  assert.equal(compositionField('image', 'scale', 'desktop', false), 'image_scale');
});
