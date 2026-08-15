import type { Coordinate, FlightArea, FlightAreaGeometry } from "./types";
import { isCircle } from "./types";

/**
 * 纯数学几何工具，不依赖 Cesium，可直接复制到任何前端/Node 项目里使用。
 *
 * 距离计算使用等距圆柱（equirectangular）局部近似：在自定义飞行区的作业尺度
 * （几百米到几公里）下与大地线距离的偏差在 0.1% 量级，远小于飞行区本身的
 * 安全余量；换成 Cesium.EllipsoidGeodesic 也可以，但必须保证「绘制时显示的
 * 半径」和「校验时判定的半径」用的是同一个函数，否则会出现界面显示 10.0 m
 * 却被判为不足 10 m 的情况。
 */

const EARTH_RADIUS_METERS = 6_371_000;

const toRadians = (value: number) => (value * Math.PI) / 180;

/** 以 origin 为原点的局部平面坐标（米），x 向东、y 向北 */
const localXY = (point: Coordinate, origin: Coordinate): [number, number] => {
  const lat0 = toRadians(origin[1]);
  return [
    toRadians(point[0] - origin[0]) * EARTH_RADIUS_METERS * Math.cos(lat0),
    toRadians(point[1] - origin[1]) * EARTH_RADIUS_METERS,
  ];
};

export const distanceMeters = (a: Coordinate, b: Coordinate): number => {
  const [x, y] = localXY(a, b);
  return Math.hypot(x, y);
};

/** 归一化为闭环（末点 === 首点）并去掉连续重复点 */
export const closedRing = (ring: Coordinate[]): Coordinate[] => {
  const deduped: Coordinate[] = [];
  ring.forEach((point) => {
    const previous = deduped[deduped.length - 1];
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) {
      deduped.push(point);
    }
  });
  if (deduped.length < 2) return deduped;
  const first = deduped[0];
  const last = deduped[deduped.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return deduped;
  return [...deduped, first];
};

/** 开环顶点（去掉与首点重复的闭环点） */
export const openRing = (ring: Coordinate[]): Coordinate[] => {
  const closed = closedRing(ring);
  if (closed.length < 2) return closed;
  return closed.slice(0, -1);
};

/** 多边形不重复顶点数（闭环点不计），开环/闭环输入均可 */
export const polygonVertexCount = (coordinates: Coordinate[]): number =>
  Math.max(0, closedRing(coordinates).length - 1);

/** 点是否在环内，以及到环边界的最近距离（米）。ring 必须是闭环。 */
const polygonContainsAndBoundary = (
  point: Coordinate,
  ring: Coordinate[],
): { inside: boolean; boundary: number } => {
  const points = ring.map((vertex) => localXY(vertex, point));
  let inside = false;
  let boundary = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    const [ax, ay] = points[index - 1];
    const [bx, by] = points[index];
    // 射线法：以待测点为原点向 +x 方向发射
    if (ay > 0 !== by > 0) {
      const crossX = ax + ((bx - ax) * -ay) / (by - ay);
      if (crossX > 0) inside = !inside;
    }
    const dx = bx - ax;
    const dy = by - ay;
    const denom = dx * dx + dy * dy;
    const t = denom === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / denom));
    boundary = Math.min(boundary, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return { inside, boundary };
};

const orientation = (a: Coordinate, b: Coordinate, c: Coordinate) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

const onSegment = (a: Coordinate, b: Coordinate, p: Coordinate) =>
  Math.min(a[0], b[0]) <= p[0] &&
  p[0] <= Math.max(a[0], b[0]) &&
  Math.min(a[1], b[1]) <= p[1] &&
  p[1] <= Math.max(a[1], b[1]);

/**
 * 线段相交（含端点接触与共线重叠）。直接在经纬度平面上判定：
 * 相交与否对仿射变换不变，作业尺度下与投影到平面后的结果一致。
 */
const segmentsIntersect = (
  a1: Coordinate,
  a2: Coordinate,
  b1: Coordinate,
  b2: Coordinate,
): boolean => {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  if (o1 === 0 && onSegment(a1, a2, b1)) return true;
  if (o2 === 0 && onSegment(a1, a2, b2)) return true;
  if (o3 === 0 && onSegment(b1, b2, a1)) return true;
  if (o4 === 0 && onSegment(b1, b2, a2)) return true;
  return false;
};

/** 多边形自相交检测（非相邻边相交或接触即视为自相交），开环/闭环输入均可 */
export const polygonSelfIntersects = (coordinates: Coordinate[]): boolean => {
  const ring = closedRing(coordinates);
  const edgeCount = ring.length - 1;
  if (edgeCount < 3) return false;
  for (let i = 0; i < edgeCount; i += 1) {
    for (let j = i + 1; j < edgeCount; j += 1) {
      // 跳过共享端点的相邻边（含首尾两条边）
      if (j === i + 1 || (i === 0 && j === edgeCount - 1)) continue;
      if (segmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) return true;
    }
  }
  return false;
};

const ringsOverlap = (a: Coordinate[], b: Coordinate[]): boolean => {
  const ringA = closedRing(a);
  const ringB = closedRing(b);
  if (ringA.length < 4 || ringB.length < 4) return false;
  for (let i = 0; i < ringA.length - 1; i += 1) {
    for (let j = 0; j < ringB.length - 1; j += 1) {
      if (segmentsIntersect(ringA[i], ringA[i + 1], ringB[j], ringB[j + 1])) return true;
    }
  }
  // 无边相交时，只有一方整体落在另一方内部才算重叠
  return (
    polygonContainsAndBoundary(ringA[0], ringB).inside ||
    polygonContainsAndBoundary(ringB[0], ringA).inside
  );
};

/** 两个飞行区几何是否重叠（圆-圆用圆心距，圆-多边形用边界距，多边形-多边形用边相交 + 互含） */
export const geometriesOverlap = (
  a: FlightAreaGeometry,
  b: FlightAreaGeometry,
): boolean => {
  if (isCircle(a) && isCircle(b)) {
    return distanceMeters(a.center, b.center) < a.radius + b.radius;
  }
  if (isCircle(a) || isCircle(b)) {
    const circle = (isCircle(a) ? a : b) as { center: Coordinate; radius: number };
    const polygon = (isCircle(a) ? b : a) as { coordinates: Coordinate[] };
    const ring = closedRing(polygon.coordinates);
    if (ring.length < 4) return false;
    const { inside, boundary } = polygonContainsAndBoundary(circle.center, ring);
    return inside || boundary < circle.radius;
  }
  return ringsOverlap(
    (a as { coordinates: Coordinate[] }).coordinates,
    (b as { coordinates: Coordinate[] }).coordinates,
  );
};

/**
 * 在已有作业区（dfence）中查找第一个与给定几何重叠的区域。
 * 限飞区（nfz）不参与：nfz 落在 dfence 内部是正常的「挖除」画法。
 */
export const findOverlappingDfence = (
  geometry: FlightAreaGeometry,
  areas: FlightArea[],
  excludeAreaId?: string | null,
): FlightArea | null => {
  for (const area of areas) {
    if (area.areaType !== "dfence" || area.id === excludeAreaId) continue;
    if (geometriesOverlap(geometry, area.geometry)) return area;
  }
  return null;
};

/** 把圆采样成环，仅用于显示；文件里圆始终存 圆心 + 半径 */
export const sampleCircleRing = (
  center: Coordinate,
  radius: number,
  samples = 96,
): Coordinate[] => {
  const metersPerLat = 111_320;
  const metersPerLng = Math.max(1, metersPerLat * Math.cos(toRadians(center[1])));
  const ring: Coordinate[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const angle = (index / samples) * Math.PI * 2;
    ring.push([
      center[0] + (Math.cos(angle) * radius) / metersPerLng,
      center[1] + (Math.sin(angle) * radius) / metersPerLat,
    ]);
  }
  return ring;
};

/** 任意几何的显示用环（闭环） */
export const geometryRing = (geometry: FlightAreaGeometry): Coordinate[] =>
  isCircle(geometry)
    ? sampleCircleRing(geometry.center, geometry.radius)
    : closedRing(geometry.coordinates);

const ringCentroid = (ring: Coordinate[]): Coordinate => {
  const points = openRing(ring);
  if (!points.length) return [0, 0];
  const total = points.reduce<Coordinate>(
    (sum, [lng, lat]) => [sum[0] + lng, sum[1] + lat],
    [0, 0],
  );
  return [total[0] / points.length, total[1] / points.length];
};

/** 几何中心与外接半径（米），用于相机定位 */
export const geometryFocus = (
  geometry: FlightAreaGeometry,
): { center: Coordinate; radius: number } => {
  if (isCircle(geometry)) return { center: geometry.center, radius: geometry.radius };
  const ring = openRing(geometry.coordinates);
  const center = ringCentroid(ring);
  const radius = ring.reduce(
    (max, point) => Math.max(max, distanceMeters(center, point)),
    0,
  );
  return { center, radius };
};

export const isValidCoordinate = (point: Coordinate): boolean =>
  Number.isFinite(point[0]) &&
  Number.isFinite(point[1]) &&
  point[0] >= -180 &&
  point[0] <= 180 &&
  point[1] >= -90 &&
  point[1] <= 90;
