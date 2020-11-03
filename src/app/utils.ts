export type BBox = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
};

export const getBoundingBox = (points: { x: number; y: number }[]): BBox => {
  const right = points.reduce((p, c) => Math.max(p, c.x), 0);
  const left = points.reduce((p, c) => Math.min(p, c.x), Number.MAX_VALUE);
  const width = Math.floor(right - left);
  const bottom = points.reduce((p, c) => Math.max(p, c.y), 0);
  const top = points.reduce((p, c) => Math.min(p, c.y), Number.MAX_VALUE);
  const height = Math.floor(bottom - top);
  return {
    top,
    bottom,
    left,
    right,
    width,
    height,
  };
};

export const pointInBBox = (
  point: { x: number; y: number },
  bbox: BBox
): boolean => {
  return (
    point.x > bbox.left &&
    point.x < bbox.right &&
    point.y > bbox.top &&
    point.y < bbox.bottom
  );
};
