/** v10: { x: 0..1, y: 0..1 } → v11: PositionAnchor string */
export function mapLegacyMarkerAnchor(anchor) {
  if (anchor == null) return 'center';
  if (typeof anchor === 'string') return anchor;

  const x = Number(anchor.x);
  const y = Number(anchor.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 'center';

  const xPos = x <= 0.25 ? 'left' : x >= 0.75 ? 'right' : '';
  const yPos = y <= 0.25 ? 'top' : y >= 0.75 ? 'bottom' : '';

  if (!xPos && !yPos) return 'center';
  if (!xPos) return yPos;
  if (!yPos) return xPos;
  return `${yPos}-${xPos}`;
}

export function mapLegacyMarkerOffset(offset) {
  if (!offset) return undefined;
  if (Array.isArray(offset) && offset.length >= 2) {
    return [Number(offset[0]) || 0, Number(offset[1]) || 0];
  }
  return undefined;
}
