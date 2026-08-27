import assert from 'node:assert/strict';
import test from 'node:test';
import { clamp, compositionField, elementLayout, imageLayout } from '../src/lib/banner-layout.ts';

const banner = {
  object_position_x: 30, object_position_y: 40, image_scale: 120,
  title_x: 8, title_y: 12, title_width: 70, title_scale: 100,
  mobile_override: true, mobile_image_x: 60, mobile_image_y: 70, mobile_image_scale: 90,
  mobile_title_x: 5, mobile_title_y: 18, mobile_title_width: 88, mobile_title_scale: 110,
} as never;

test('banner layout selects normalized desktop and explicit mobile composition', () => {
  assert.deepEqual(imageLayout(banner, 'desktop'), { x: 30, y: 40, scale: 120 });
  assert.deepEqual(imageLayout(banner, 'mobile'), { x: 60, y: 70, scale: 90 });
  assert.deepEqual(elementLayout(banner, 'title', 'mobile'), { x: 5, y: 18, width: 88, scale: 110 });
});

test('composition helpers clamp values and map fields without pixels', () => {
  assert.equal(clamp(140, 0, 100), 100);
  assert.equal(clamp(-12, 0, 100), 0);
  assert.equal(compositionField('title', 'x', 'mobile', true), 'mobile_title_x');
  assert.equal(compositionField('image', 'scale', 'desktop', false), 'image_scale');
});
