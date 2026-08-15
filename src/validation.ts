import {
  findOverlappingDfence,
  isValidCoordinate,
  openRing,
  polygonSelfIntersects,
  polygonVertexCount,
} from "./geometry";
import type { FlightArea, FlightAreaGeometry, FlightAreaType } from "./types";
import { isCircle } from "./types";

/**
 * 自定义飞行区几何的约束分两类：
 *
 * A. 协议硬性要求（不满足机场无法正确加载）
 *    - 坐标必须是合法 WGS84 经纬度
 *    - 多边形至少 3 个不同顶点，闭环后（含闭环点）最多 255 个点
 *    - 圆半径下限 10 m（官方模板注明校验范围为【10，无限】）
 *
 * B. 本 demo 的绘制约定
 *    - 落子上限 254 个顶点（+1 个闭环点 = 协议上限 255）
 *    - 多边形不允许自相交（自相交的边界含义不明确）
 *    - 作业区（dfence）之间不允许重叠；限飞区（nfz）不受此限
 */

/** 协议上限：闭环后（含闭环点）的最大点数 */
export const MAX_POLYGON_POINTS = 255;
/** 可落子的顶点数上限，保存时补闭环点后正好等于协议上限 */
export const MAX_POLYGON_VERTICES = MAX_POLYGON_POINTS - 1;
/** 圆形飞行区最小半径（米） */
export const MIN_CIRCLE_RADIUS_METERS = 10;
/** 多边形最少顶点数 */
export const MIN_POLYGON_VERTICES = 3;

/** 作业区之间不允许重叠；限飞区不参与判定 */
const overlapError = (
  geometry: FlightAreaGeometry,
  areaType: FlightAreaType,
  areas: FlightArea[],
  excludeAreaId?: string | null,
): string | null => {
  if (areaType !== "dfence") return null;
  const conflict = findOverlappingDfence(geometry, areas, excludeAreaId);
  return conflict ? `与已有作业区「${conflict.name}」重叠` : null;
};

/**
 * 统一校验入口，返回中文错误信息，null 表示通过。
 * 绘制完成与文件导入都走这里，避免两处规则走偏。
 */
export const validateFlightAreaGeometry = (
  geometry: FlightAreaGeometry,
  areaType: FlightAreaType,
  areas: FlightArea[],
  excludeAreaId?: string | null,
): string | null => {
  if (isCircle(geometry)) {
    if (!isValidCoordinate(geometry.center)) return "圆心坐标超出 WGS84 合法范围";
    if (!Number.isFinite(geometry.radius) || geometry.radius < MIN_CIRCLE_RADIUS_METERS) {
      return `圆形飞行区半径不得小于 ${MIN_CIRCLE_RADIUS_METERS} 米`;
    }
    return overlapError(geometry, areaType, areas, excludeAreaId);
  }
  const vertices = openRing(geometry.coordinates);
  if (vertices.some((point) => !isValidCoordinate(point))) {
    return "多边形包含超出 WGS84 合法范围的坐标";
  }
  const count = polygonVertexCount(geometry.coordinates);
  if (count < MIN_POLYGON_VERTICES) {
    return `多边形至少需要 ${MIN_POLYGON_VERTICES} 个不同顶点`;
  }
  if (count > MAX_POLYGON_VERTICES) {
    return `多边形最多 ${MAX_POLYGON_VERTICES} 个顶点（闭环后 ${MAX_POLYGON_POINTS} 点为协议上限）`;
  }
  if (polygonSelfIntersects(geometry.coordinates)) {
    return "多边形边界自相交，请重新绘制";
  }
  return overlapError(geometry, areaType, areas, excludeAreaId);
};
