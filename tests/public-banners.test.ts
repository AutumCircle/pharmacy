import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { toPublicBannersPayload } from '../src/lib/public-banners.ts';
import type { HomepageBanner } from '../src/lib/api-v1/types.ts';

const mobile = {
  slot: 'mobile', title: null, subtitle: null,
  image_url: 'https://example.com/banner.png', link_url: '/catalog',
  cta_text: null, alt_text: 'Аптека Ватан', fit_mode: 'contain',
  object_position_x: 50, object_position_y: 50, image_width: 1080, image_height: 1920,
  overlay_enabled: false, overlay_color: '#FFFFFF', overlay_opacity: 0,
  overlay_type: 'solid', overlay_direction: 'to_right', text_color: '#333333',
  text_align: 'left', content_vertical: 'top', title_size: 26,
  subtitle_size: 16, content_max_width: 75, image_scale: 100,
  contain_background: 'color', contain_background_color: '#F5F5F5',
  title_x: 8, title_y: 12, title_width: 75, title_scale: 100,
  subtitle_x: 8, subtitle_y: 38, subtitle_width: 75, subtitle_scale: 100,
  cta_x: 8, cta_y: 65, cta_width: 35, cta_scale: 100,
  mobile_override: true, mobile_image_x: 50, mobile_image_y: 50, mobile_image_scale: 100,
  mobile_title_x: 8, mobile_title_y: 12, mobile_title_width: 84, mobile_title_scale: 100,
  mobile_subtitle_x: 8, mobile_subtitle_y: 38, mobile_subtitle_width: 84, mobile_subtitle_scale: 100,
  mobile_cta_x: 8, mobile_cta_y: 68, mobile_cta_width: 55, mobile_cta_scale: 100,
} as const satisfies HomepageBanner;

test('public banner response preserves image-only mobile composition and excludes unknown fields', () => {
  const input = { ...mobile, is_active: true, updated_at: '2026-10-16', internal_note: 'private' };
  const payload = toPublicBannersPayload([input as HomepageBanner]);
  assert.deepEqual(Object.keys(payload), ['banners']);
  assert.equal(payload.banners.length, 1);
  assert.equal(payload.banners[0].slot, 'mobile');
  assert.equal(payload.banners[0].image_url, mobile.image_url);
  assert.equal(payload.banners[0].title, null);
  assert.equal(payload.banners[0].fit_mode, 'contain');
  assert.equal(payload.banners[0].mobile_override, true);
  assert.equal(payload.banners[0].mobile_image_scale, 100);
  for (const forbidden of ['is_active', 'updated_at', 'internal_note', 'request_id', 'API_KEY']) {
    assert.ok(!(forbidden in payload.banners[0]));
  }
});

test('empty and inactive banners are omitted without reordering visible slots', () => {
  const inactive = { ...mobile, slot: 'left' as const, is_active: false };
  const empty = { ...mobile, slot: 'center' as const, image_url: null, title: null, subtitle: null };
  const visible = { ...mobile, slot: 'right_top' as const, title: 'Акция' };
  const payload = toPublicBannersPayload([inactive, empty, visible, mobile] as HomepageBanner[]);
  assert.deepEqual(payload.banners.map((banner) => banner.slot), ['right_top', 'mobile']);
  assert.deepEqual(toPublicBannersPayload(null), { banners: [] });
});

const route = readFileSync('src/app/api/homepage-banners/route.ts', 'utf8');
const mapper = readFileSync('src/lib/public-banners.ts', 'utf8');

test('GET route uses server-only banner helper, brief cache and fixed no-store error', () => {
  assert.match(route, /getPublicHomepageBanners\(\)/);
  assert.match(route, /export const dynamic = 'force-dynamic'/);
  assert.match(route, /export async function GET\(/);
  assert.match(route, /public, s-maxage=60, stale-while-revalidate=300/);
  assert.match(route, /status: 503/);
  assert.match(route, /'Cache-Control': 'no-store'/);
  assert.match(route, /BANNERS_UNAVAILABLE/);
  assert.doesNotMatch(route, /process\.env|API_KEY|x-api-key|Access-Control-Allow-Origin|error\.message/);
  assert.doesNotMatch(mapper, /process\.env|API_KEY|x-api-key|Access-Control-Allow-Origin/);
});
