/** Maps the 0 to 100 volume slider to a linear gain with a rough perceptual curve. */
export function volumeToGain(volume: number): number {
  const clamped = Math.min(100, Math.max(0, volume)) / 100;
  return clamped * clamped;
}
