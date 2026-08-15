import * as Cesium from "cesium";

import { geometryFocus, geometryRing } from "./geometry";
import type { Coordinate, FlightArea } from "./types";

/** 作业区绿、限飞区红、停用灰 */
const DFENCE_COLOR = Cesium.Color.fromCssColorString("#20df55");
const NFZ_COLOR = Cesium.Color.fromCssColorString("#ff3030");
const DISABLED_COLOR = Cesium.Color.fromCssColorString("#8b949e");

const ENTITY_PREFIX = "flight-area-";

export const areaColor = (area: FlightArea): Cesium.Color => {
  if (!area.enabled) return DISABLED_COLOR;
  return area.areaType === "nfz" ? NFZ_COLOR : DFENCE_COLOR;
};

const toPositions = (ring: Coordinate[], height = 0) =>
  ring.map(([lng, lat]) => Cesium.Cartesian3.fromDegrees(lng, lat, height));

const removeEntitiesByPrefix = (viewer: Cesium.Viewer, prefix: string) => {
  viewer.entities.values
    .filter((entity) => entity.id.startsWith(prefix))
    .forEach((entity) => viewer.entities.remove(entity));
};

/**
 * 全量重建飞行区实体。区域数量是几十个量级，整体重建比增量 diff 更不容易出错。
 *
 * 填充面放在高度 0，边线放在高度 1：两者同高会 Z-fighting，边线会闪烁。
 */
export const renderAreas = (
  viewer: Cesium.Viewer,
  areas: FlightArea[],
  selectedAreaId: string | null,
) => {
  removeEntitiesByPrefix(viewer, ENTITY_PREFIX);
  areas.forEach((area) => {
    const ring = geometryRing(area.geometry);
    if (ring.length < 2) return;
    const color = areaColor(area);
    const selected = area.id === selectedAreaId;
    const { center } = geometryFocus(area.geometry);
    viewer.entities.add({
      id: `${ENTITY_PREFIX}${area.id}`,
      properties: { flightAreaId: area.id },
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(toPositions(ring)),
        height: 0,
        material: color.withAlpha(area.enabled ? 0.18 : 0.08),
      },
      polyline: {
        positions: toPositions(ring, 1),
        width: selected ? 5 : 3,
        material: color.withAlpha(area.enabled ? 1 : 0.7),
        arcType: Cesium.ArcType.GEODESIC,
      },
      position: Cesium.Cartesian3.fromDegrees(center[0], center[1], 1),
      label: {
        text: area.name,
        font: "bold 13px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  });
};

/** 点击拾取到的飞行区 id，没点中返回 null */
export const pickAreaId = (
  viewer: Cesium.Viewer,
  position: Cesium.Cartesian2,
): string | null => {
  const picked = viewer.scene.pick(position);
  const entity = picked?.id as Cesium.Entity | undefined;
  const value = entity?.properties?.flightAreaId?.getValue(Cesium.JulianDate.now());
  return typeof value === "string" ? value : null;
};
