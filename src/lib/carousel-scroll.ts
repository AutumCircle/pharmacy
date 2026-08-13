export function carouselVisibleCount(trackWidth: number, cardWidth: number, gap: number): number {
  if (trackWidth <= 0 || cardWidth <= 0) return 1;
  return Math.max(1, Math.floor((trackWidth + Math.max(0, gap)) / (cardWidth + Math.max(0, gap))));
}

export function carouselPageStep(trackWidth: number, cardWidth: number, gap: number): number {
  return carouselVisibleCount(trackWidth, cardWidth, gap) * (cardWidth + Math.max(0, gap));
}

export function clampCarouselTarget(target: number, scrollWidth: number, clientWidth: number): number {
  return Math.min(Math.max(0, target), Math.max(0, scrollWidth - clientWidth));
}

export function carouselBoundaryState(
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
  tolerance = 2,
): { atStart: boolean; atEnd: boolean } {
  const maximum = Math.max(0, scrollWidth - clientWidth);
  return {
    atStart: scrollLeft <= tolerance,
    atEnd: maximum - scrollLeft <= tolerance,
  };
}
