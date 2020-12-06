import { Offset } from './cornerstone-types';

export type BBox = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
};

export const getBoundingBox = (points: { x: number; y: number }[]): BBox => {
  const right = Math.ceil(points.reduce((p, c) => Math.max(p, c.x), 0));
  const left = Math.floor(
    points.reduce((p, c) => Math.min(p, c.x), Number.MAX_VALUE)
  );
  const width = right - left;
  const bottom = Math.ceil(points.reduce((p, c) => Math.max(p, c.y), 0));
  const top = Math.floor(
    points.reduce((p, c) => Math.min(p, c.y), Number.MAX_VALUE)
  );
  const height = bottom - top;
  return {
    top,
    bottom,
    left,
    right,
    width,
    height,
  };
};

export const rescaleBoundingBox = (bbox: BBox, ratio: number): BBox => {
  const left = Math.floor(bbox.left * ratio);
  const right = Math.ceil(bbox.right * ratio);
  const top = Math.floor(bbox.top * ratio);
  const bottom = Math.ceil(bbox.bottom * ratio);
  return {
    left,
    right,
    top,
    bottom,
    height: bottom - top,
    width: right - left,
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

export const roisAreEqual = (points1: Offset[], points2: Offset[]): boolean => {
  if (points1 === undefined || points2 === undefined) {
    return false;
  }
  return (
    points1.length === points2.length &&
    points2.every((p2, index) => {
      const p1 = points1[index];
      return p2.x === p1.x && p2.y === p1.y;
    })
  );
};

export const arraysAreEqual = <T>(points1: T[], points2: T[]): boolean => {
  if (points1 === undefined || points2 === undefined) {
    return false;
  }
  return (
    points1.length === points2.length &&
    points2.every((p2, index) => {
      const p1 = points1[index];
      return p2 === p1;
    })
  );
};
