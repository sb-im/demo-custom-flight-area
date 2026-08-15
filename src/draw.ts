import * as Cesium from "cesium";

import { closedRing, distanceMeters, sampleCircleRing } from "./geometry";
import type { Coordinate, FlightAreaGeometry } from "./types";
import { MAX_POLYGON_VERTICES, MIN_CIRCLE_RADIUS_METERS } from "./validation";
import { pickCoordinate } from "./viewer";

/**
 * Cesium 上的飞行区绘制交互。
 *
 * 多边形：左键落子，双击或右键结束，Esc 取消。
 * 圆形：  第一次左键定圆心，第二次左键定半径，Esc 取消。
 *
 * 边长 / 半径实时标注不是装饰：圆形有 10 m 最小半径的硬约束，
 * 没有读数的话用户很难知道自己画的圆是不是已经够大。
 */

export type DrawMode = "polygon" | "circle";

export interface DrawSession {
  destroy: () => void;
}

interface DrawSessionOptions {
  viewer: Cesium.Viewer;
  mode: DrawMode;
  color: Cesium.Color;
  /** 返回中文错误信息表示不允许结束绘制，null 表示通过 */
  validate: (geometry: FlightAreaGeometry) => string | null;
  onFinish: (geometry: FlightAreaGeometry) => void;
  onCancel: () => void;
  onMessage: (text: string) => void;
}

const TEMP_PREFIX = "flight-area-draw-";

const formatMeters = (value: number): string =>
  value >= 1000 ? `${(value / 1000).toFixed(2)} km` : `${value.toFixed(1)} m`;

const measureLabel = (
  text: string | Cesium.Property,
): Cesium.LabelGraphics.ConstructorOptions => ({
  text,
  font: "12px sans-serif",
  fillColor: Cesium.Color.WHITE,
  outlineColor: Cesium.Color.BLACK,
  outlineWidth: 3,
  style: Cesium.LabelStyle.FILL_AND_OUTLINE,
  pixelOffset: new Cesium.Cartesian2(0, -14),
  disableDepthTestDistance: Number.POSITIVE_INFINITY,
});

export const startDrawSession = (options: DrawSessionOptions): DrawSession => {
  const { viewer, mode, color, validate, onFinish, onCancel, onMessage } = options;
  const canvas = viewer.scene.canvas;
  const previousCursor = canvas.style.cursor;
  canvas.style.cursor = "crosshair";

  const points: Coordinate[] = [];
  let mousePoint: Coordinate | null = null;
  let finished = false;
  const tempIds: string[] = [];

  const addTemp = (entity: Cesium.Entity.ConstructorOptions) => {
    const id = entity.id as string;
    viewer.entities.add(entity);
    tempIds.push(id);
  };

  const clearTemp = () => {
    tempIds.forEach((id) => viewer.entities.removeById(id));
    tempIds.length = 0;
  };

  const addVertexDot = (coordinate: Coordinate) => {
    addTemp({
      id: `${TEMP_PREFIX}vertex-${tempIds.length}`,
      position: Cesium.Cartesian3.fromDegrees(coordinate[0], coordinate[1], 1),
      point: {
        pixelSize: 9,
        color,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  };

  const addEdgeLabel = (start: Coordinate, end: Coordinate) => {
    addTemp({
      id: `${TEMP_PREFIX}edge-${tempIds.length}`,
      position: Cesium.Cartesian3.fromDegrees(
        (start[0] + end[0]) / 2,
        (start[1] + end[1]) / 2,
        1,
      ),
      label: measureLabel(formatMeters(distanceMeters(start, end))),
    });
  };

  /** 预览环：多边形跟随鼠标补一条边，圆按当前半径采样 */
  const previewRing = (): Coordinate[] => {
    if (mode === "circle") {
      if (!points[0] || !mousePoint) return [];
      const radius = distanceMeters(points[0], mousePoint);
      return radius >= 0.5 ? sampleCircleRing(points[0], radius) : [];
    }
    const ring = mousePoint ? [...points, mousePoint] : [...points];
    return ring.length > 2 ? [...ring, ring[0]] : ring;
  };

  addTemp({
    id: `${TEMP_PREFIX}preview`,
    polyline: {
      positions: new Cesium.CallbackProperty(
        () =>
          previewRing().map(([lng, lat]) => Cesium.Cartesian3.fromDegrees(lng, lat, 1)),
        false,
      ),
      width: 3,
      material: color,
      arcType: Cesium.ArcType.GEODESIC,
    },
  });

  // 跟随鼠标的读数：多边形是当前这条边的长度，圆是半径
  addTemp({
    id: `${TEMP_PREFIX}measure`,
    position: new Cesium.CallbackPositionProperty(() => {
      const anchor = mode === "circle" ? points[0] : points[points.length - 1];
      if (!anchor || !mousePoint) return undefined;
      return Cesium.Cartesian3.fromDegrees(
        (anchor[0] + mousePoint[0]) / 2,
        (anchor[1] + mousePoint[1]) / 2,
        1,
      );
    }, false),
    label: {
      ...measureLabel(
        new Cesium.CallbackProperty(() => {
          const anchor = mode === "circle" ? points[0] : points[points.length - 1];
          return anchor && mousePoint ? formatMeters(distanceMeters(anchor, mousePoint)) : "";
        }, false),
      ),
      show: new Cesium.CallbackProperty(() => points.length > 0 && !!mousePoint, false),
    },
  });

  if (mode === "circle") {
    addTemp({
      id: `${TEMP_PREFIX}radius-line`,
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          if (!points[0] || !mousePoint) return [];
          return [
            Cesium.Cartesian3.fromDegrees(points[0][0], points[0][1], 1),
            Cesium.Cartesian3.fromDegrees(mousePoint[0], mousePoint[1], 1),
          ];
        }, false),
        width: 2,
        material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.WHITE }),
        arcType: Cesium.ArcType.GEODESIC,
      },
    });
  }

  /** 去掉相距 0.5 m 以内的连续重复点（双击会额外产生一次左键落子） */
  const dedupedPoints = (): Coordinate[] => {
    const result: Coordinate[] = [];
    points.forEach((point) => {
      const previous = result[result.length - 1];
      if (!previous || distanceMeters(previous, point) > 0.5) result.push(point);
    });
    return result;
  };

  const complete = (geometry: FlightAreaGeometry) => {
    const error = validate(geometry);
    if (error) {
      onMessage(error);
      return;
    }
    finished = true;
    clearTemp();
    onFinish(geometry);
  };

  const finishPolygon = () => {
    if (finished) return;
    const vertices = dedupedPoints();
    if (vertices.length < 3) {
      onMessage("多边形至少需要 3 个顶点");
      return;
    }
    complete({ coordinates: closedRing(vertices) });
  };

  const cancel = () => {
    if (finished) return;
    finished = true;
    clearTemp();
    onCancel();
  };

  const handler = new Cesium.ScreenSpaceEventHandler(canvas);

  handler.setInputAction((event: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    if (finished) return;
    const coordinate = pickCoordinate(viewer, event.position);
    if (!coordinate) return;

    if (mode === "circle") {
      if (points.length === 0) {
        points.push(coordinate);
        mousePoint = coordinate;
        addVertexDot(coordinate);
        return;
      }
      const radius = distanceMeters(points[0], coordinate);
      if (radius < MIN_CIRCLE_RADIUS_METERS) {
        onMessage(`圆形飞行区半径不得小于 ${MIN_CIRCLE_RADIUS_METERS} 米`);
        return;
      }
      complete({ center: points[0], radius: Math.round(radius * 100) / 100 });
      return;
    }

    if (points.length >= MAX_POLYGON_VERTICES) {
      onMessage(`多边形最多 ${MAX_POLYGON_VERTICES} 个顶点`);
      return;
    }
    points.push(coordinate);
    addVertexDot(coordinate);
    if (points.length >= 2) addEdgeLabel(points[points.length - 2], points[points.length - 1]);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  handler.setInputAction((event: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
    if (finished) return;
    const coordinate = pickCoordinate(viewer, event.endPosition);
    if (coordinate) mousePoint = coordinate;
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  if (mode === "polygon") {
    handler.setInputAction(finishPolygon, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    handler.setInputAction(() => {
      if (dedupedPoints().length >= 3) finishPolygon();
      else cancel();
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  } else {
    handler.setInputAction(cancel, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  }

  const onContextMenu = (event: Event) => event.preventDefault();
  canvas.addEventListener("contextmenu", onContextMenu);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") cancel();
  };
  document.addEventListener("keydown", onKeyDown);

  return {
    destroy: () => {
      canvas.style.cursor = previousCursor;
      canvas.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("keydown", onKeyDown);
      if (!handler.isDestroyed()) handler.destroy();
      clearTemp();
    },
  };
};
