import assert from 'node:assert/strict';
import test from 'node:test';

import { carouselBoundaryState, carouselPageStep, carouselVisibleCount, clampCarouselTarget } from '../src/lib/carousel-scroll.ts';

test('responsive carousel keeps fixed cards and reduces visible count', () => {
  const widths = [1200, 1200, 994, 738, 345];
  assert.deepEqual(widths.map((width) => carouselVisibleCount(width, 255, 18)), [4, 4, 3, 2, 1]);
  assert.equal(carouselPageStep(994, 255, 18), 819);
});

test('carousel target and boundary controls never pass valid limits', () => {
  assert.equal(clampCarouselTarget(-200, 1500, 1000), 0);
  assert.equal(clampCarouselTarget(900, 1500, 1000), 500);
  assert.deepEqual(carouselBoundaryState(0, 1500, 1000), { atStart: true, atEnd: false });
  assert.deepEqual(carouselBoundaryState(500, 1500, 1000), { atStart: false, atEnd: true });
});
