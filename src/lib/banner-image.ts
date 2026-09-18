// The upload canvas and both renderers share the same aspect ratio.
export const bannerDimensions = {
  left: { width: 1000, height: 1400, referenceWidth: 320 },
  center: { width: 1500, height: 1000, referenceWidth: 680 },
  right_top: { width: 1600, height: 900, referenceWidth: 360 },
  right_bottom: { width: 1600, height: 900, referenceWidth: 360 },
  mobile: { width: 1200, height: 600, referenceWidth: 390 },
} as const;

export function containImage(sourceWidth: number, sourceHeight: number, width: number, height: number) {
  if (![sourceWidth, sourceHeight, width, height].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('Некорректный размер изображения');
  }
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = Math.min(width, sourceWidth * scale);
  const drawHeight = Math.min(height, sourceHeight * scale);
  return { x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, width: drawWidth, height: drawHeight };
}
