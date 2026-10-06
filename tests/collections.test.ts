import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attributionForOrder,
  collectionSlugFromPath,
  formatOrderSource,
  isBotUserAgent,
  parseSource,
  readUtm,
  serializeSource,
} from '../src/lib/collections.ts';

const DAY = 24 * 60 * 60 * 1000;

test('preview crawlers and bots are not counted', () => {
  for (const agent of [
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'meta-externalagent/1.1',
    'Facebot',
    'Googlebot/2.1',
    'SomeCrawler/1.0',
    'Spider',
    'LinkPreview/1.0',
    '',
  ]) {
    assert.equal(isBotUserAgent(agent), true, agent);
  }
  assert.equal(isBotUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Instagram 300.0'), false);
  assert.equal(isBotUserAgent(null), true);
});

test('UTM labels are read, trimmed and limited', () => {
  const utm = readUtm('?utm_source=instagram&utm_medium=%20dm%20&utm_campaign=post_oct6&utm_content=' + 'x'.repeat(300));
  assert.equal(utm.utm_source, 'instagram');
  assert.equal(utm.utm_medium, 'dm');
  assert.equal(utm.utm_content?.length, 100);
  assert.equal(readUtm('?a=1').utm_source, null);
});

test('source cookie round-trips and expires after seven days', () => {
  const now = Date.now();
  const source = { collection: 'oct-6', utm: readUtm('?utm_source=instagram&utm_medium=dm'), savedAt: now };
  const parsed = parseSource(serializeSource(source), now + DAY);
  assert.equal(parsed?.collection, 'oct-6');
  assert.equal(parsed?.utm.utm_medium, 'dm');
  assert.equal(parseSource(serializeSource(source), now + 8 * DAY), null);
  assert.equal(parseSource('garbage', now), null);
  assert.equal(parseSource(undefined, now), null);
});

test('order attribution is built only from a valid source', () => {
  const now = Date.now();
  assert.equal(attributionForOrder(null), null);
  const direct = parseSource(serializeSource({ collection: null, utm: readUtm('?utm_source=instagram&utm_content=story1'), savedAt: now }), now);
  assert.deepEqual(attributionForOrder(direct), { utm_source: 'instagram', utm_content: 'story1' });
  const forged = parseSource(encodeURIComponent(JSON.stringify({ c: 'Bad Slug!', ts: now })), now);
  assert.equal(forged, null);
});

test('order source label matches the admin format', () => {
  assert.equal(
    formatOrderSource({ source_collection: 'oct-6', utm_source: 'instagram', utm_medium: 'dm' }),
    'Подборка oct-6 · instagram / dm',
  );
  assert.equal(formatOrderSource({ utm_source: 'instagram', utm_medium: 'story' }), 'UTM: instagram / story');
  assert.equal(formatOrderSource({}), null);
});

test('collection slug is read from the path', () => {
  assert.equal(collectionSlugFromPath('/podborka/oct-6'), 'oct-6');
  assert.equal(collectionSlugFromPath('/podborka/oct-6/'), 'oct-6');
  assert.equal(collectionSlugFromPath('/podborka/Bad Slug'), null);
  assert.equal(collectionSlugFromPath('/medicine/1'), null);
});
