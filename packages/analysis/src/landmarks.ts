import type { FaceSample } from "@video-analyzer/shared/types";
type Point = { x: number; y: number; z?: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export function measureFace(points: Point[], blends: Record<string, number>, timestamp: number, slot: number): FaceSample {
  // Ported from analysis/analyze.py. Yaw/pitch are relative image-space proxies,
  // deliberately not presented as calibrated physical head angles.
  const leftWidth = Math.max(0.001, distance(points[33], points[133]));
  const rightWidth = Math.max(0.001, distance(points[362], points[263]));
  const centerX = (points[234].x + points[454].x) / 2;
  const centerY = (points[10].y + points[152].y) / 2;
  const faceWidth = Math.max(0.001, distance(points[234], points[454]));
  const eyeX = (points[33].x + points[133].x) / 2;
  const eyeY = (points[159].y + points[145].y) / 2;
  return {
    timestamp, slot, x: centerX, y: centerY,
    eyeOpen: (distance(points[159], points[145]) / leftWidth + distance(points[386], points[374]) / rightWidth) / 2,
    brow: (Math.abs(points[70].y - points[159].y) + Math.abs(points[300].y - points[386].y)) / 2 / faceWidth,
    mouth: distance(points[13], points[14]) / Math.max(0.001, distance(points[61], points[291])),
    yaw: (points[1].x - centerX) / faceWidth,
    pitch: (points[1].y - centerY) / faceWidth,
    roll: Math.atan2(points[263].y - points[33].y, points[263].x - points[33].x) * 180 / Math.PI,
    eyeDistanceRatio: distance(points[33], points[263]) / faceWidth,
    blink: ((blends.eyeBlinkLeft || 0) + (blends.eyeBlinkRight || 0)) / 2,
    gazeX: points[468] ? (points[468].x - eyeX) / leftWidth : 0,
    gazeY: points[468] ? (points[468].y - eyeY) / leftWidth : 0,
    points: points.map(({ x, y }) => ({ x, y })),
  };
}
