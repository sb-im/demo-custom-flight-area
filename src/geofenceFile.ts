import { closedRing, isValidCoordinate, polygonVertexCount } from "./geometry";
import { md5, randomUUID, sha256 } from "./hash";
import type {
  Coordinate,
  FlightArea,
  FlightAreaType,
  PolygonGeometry,
} from "./types";
import { isCircle } from "./types";
import {
  MAX_POLYGON_POINTS,
  MIN_POLYGON_VERTICES,
  validateFlightAreaGeometry,
} from "./validation";

/**
 * 自定义飞行区文件（DJI 上云 API）的构建与解析。
 *
 * 文件形态是一个 GeoJSON FeatureCollection：
 *   圆形   -> geometry.type = "Point"，半径放在 properties.radius，
 *             并且必须带 properties.subType = "Circle"
 *   多边形 -> geometry.type = "Polygon"，coordinates[0] 是闭环外环
 *
 * 三个容易踩的点：
 * 1. 文件名必须是 geofence_{文件MD5}.json；
 * 2. flight_areas_get 里 files[].checksum 是文件的 SHA256，和文件名里的 MD5 不是一回事；
 * 3. MD5、SHA256 与 size 必须基于最终上传的同一组字节计算。本 demo 固定生成
 *    无 BOM 的紧凑 JSON，避免无意义的格式差异产生新的文件标识。
 */

const AREA_TYPE_LABEL: Record<FlightAreaType, string> = {
  dfence: "作业区",
  nfz: "限飞区",
};

interface BuiltGeofenceFile {
  /** 紧凑 JSON 文本 */
  json: string;
  bytes: Uint8Array;
  /** geofence_{md5}.json */
  fileName: string;
  md5: string;
  /** 上报/下发协议里的 files[].checksum */
  sha256: string;
  size: number;
}

/**
 * 构建自定义飞行区文件。按 id 排序保证确定性：同样的区域集合永远产出同样的
 * 字节和摘要，避免仅因输入顺序不同就产生新的文件标识。
 */
export const buildGeofenceFile = (areas: FlightArea[]): BuiltGeofenceFile => {
  const sortedAreas = [...areas].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  sortedAreas.forEach((area, index) => {
    const error = validateFlightAreaGeometry(
      area.geometry,
      area.areaType,
      sortedAreas.slice(0, index),
    );
    if (error) throw new Error(`区域「${area.name}」无法导出：${error}`);
  });

  const features = sortedAreas.map((area) => {
    if (isCircle(area.geometry)) {
      return {
        id: area.id,
        type: "Feature",
        geofence_type: area.areaType,
        geometry: { type: "Point", coordinates: area.geometry.center },
        properties: {
          subType: "Circle",
          radius: area.geometry.radius,
          enable: true,
        },
      };
    }
    return {
      id: area.id,
      type: "Feature",
      geofence_type: area.areaType,
      geometry: {
        type: "Polygon",
        coordinates: [closedRing(area.geometry.coordinates)],
      },
      properties: { radius: 0, enable: true },
    };
  });

  // JSON.stringify 默认就是紧凑输出且不带 BOM，不要为了好看加缩进
  const json = JSON.stringify({ type: "FeatureCollection", features });
  const bytes = new TextEncoder().encode(json);
  const digest = md5(bytes);
  return {
    json,
    bytes,
    fileName: `geofence_${digest}.json`,
    md5: digest,
    sha256: sha256(bytes),
    size: bytes.length,
  };
};

interface ParsedGeofenceFile {
  areas: FlightArea[];
  /** 非致命问题：被跳过的要素、不支持的字段、不满足本 demo 约定的区域 */
  warnings: string[];
}

const shortId = (id: string) => id.replace(/-/g, "").slice(0, 8);

const readCoordinate = (value: unknown): Coordinate | null => {
  if (!Array.isArray(value) || value.length < 2) return null;
  const point: Coordinate = [Number(value[0]), Number(value[1])];
  return isValidCoordinate(point) ? point : null;
};

/**
 * 解析自定义飞行区文件。整体结构不合法时抛错；单个要素有问题时跳过并记录
 * 警告，避免因为一个不支持的要素就丢掉整份文件。
 */
export const parseGeofenceFile = (text: string): ParsedGeofenceFile => {
  let raw: Record<string, unknown>;
  try {
    // 有些工具保存时会加 BOM，解析前先去掉（生成文件时绝不能加）
    raw = JSON.parse(text.replace(/^\uFEFF/, "")) as Record<string, unknown>;
  } catch (error) {
    // 官方协议模板带 // 注释，不是合法 JSON，直接导入会到这里
    throw new Error(
      `不是合法 JSON${text.includes("//") ? "（文件含 // 注释，如官方协议模板，需先删掉注释）" : ""}：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!raw || typeof raw !== "object") throw new Error("文件内容不是合法 JSON 对象");
  if (raw.type !== "FeatureCollection") {
    throw new Error('文件根节点的 type 必须是 "FeatureCollection"');
  }
  if (!Array.isArray(raw.features)) throw new Error("文件缺少 features 数组");

  const warnings: string[] = [];
  if (Array.isArray(raw.features_extend) && raw.features_extend.length > 0) {
    warnings.push(
      `文件包含 ${raw.features_extend.length} 个本 demo 暂不支持的扩展要素（如禁降区），已忽略；重新导出时不会写回`,
    );
  }

  const areas: FlightArea[] = [];
  (raw.features as Array<Record<string, any>>).forEach((feature, index) => {
    const label = `第 ${index + 1} 个要素`;
    const areaType = feature?.geofence_type;
    if (areaType !== "dfence" && areaType !== "nfz") {
      warnings.push(`${label}：不支持的 geofence_type「${String(areaType)}」，已跳过`);
      return;
    }
    const geometry = feature?.geometry;
    const properties = feature?.properties ?? {};
    const id = typeof feature?.id === "string" && feature.id ? feature.id : randomUUID();
    const enabled = properties.enable !== false;
    const name = `${AREA_TYPE_LABEL[areaType as FlightAreaType]}-${shortId(id)}`;

    if (geometry?.type === "Point") {
      const center = readCoordinate(geometry.coordinates);
      const radius = Number(properties.radius);
      if (!center) {
        warnings.push(`${label}：圆心坐标不合法，已跳过`);
        return;
      }
      if (!Number.isFinite(radius) || radius <= 0) {
        warnings.push(`${label}：圆形缺少有效的 properties.radius，已跳过`);
        return;
      }
      if (properties.subType !== "Circle") {
        warnings.push(`${label}：圆形要素缺少 properties.subType = "Circle"，已按圆形处理`);
      }
      areas.push({
        id,
        name,
        areaType,
        geometry: { center, radius },
        enabled,
      });
      return;
    }

    if (geometry?.type === "Polygon") {
      const rings = geometry.coordinates;
      if (!Array.isArray(rings) || !Array.isArray(rings[0])) {
        warnings.push(`${label}：多边形 coordinates 结构不合法，已跳过`);
        return;
      }
      if (rings.length > 1) {
        warnings.push(`${label}：多边形带有内环（挖洞），自定义飞行区不支持，已只取外环`);
      }
      const ring: Coordinate[] = [];
      let invalid = false;
      (rings[0] as unknown[]).forEach((value) => {
        const point = readCoordinate(value);
        if (!point) invalid = true;
        else ring.push(point);
      });
      if (invalid) warnings.push(`${label}：多边形包含不合法坐标，已忽略这些点`);
      const coordinates = closedRing(ring);
      const vertexCount = polygonVertexCount(coordinates);
      if (vertexCount < MIN_POLYGON_VERTICES) {
        warnings.push(`${label}：多边形不足 ${MIN_POLYGON_VERTICES} 个不同顶点，已跳过`);
        return;
      }
      if (coordinates.length > MAX_POLYGON_POINTS) {
        warnings.push(
          `${label}：多边形闭环后 ${coordinates.length} 点，超过协议上限 ${MAX_POLYGON_POINTS}，已跳过`,
        );
        return;
      }
      areas.push({
        id,
        name,
        areaType,
        geometry: { coordinates } satisfies PolygonGeometry,
        enabled,
      });
      return;
    }

    warnings.push(
      `${label}：不支持的 geometry.type「${String(geometry?.type)}」，已跳过`,
    );
  });

  // 协议允许、但不满足本 demo 绘制约定的区域只提示不丢弃：
  // 别的平台生成的文件可能确实存在半径 <10 m 之类的情况。
  areas.forEach((area, index) => {
    const error = validateFlightAreaGeometry(
      area.geometry,
      area.areaType,
      areas.slice(0, index),
    );
    if (error) warnings.push(`「${area.name}」不满足本 demo 的绘制约定：${error}`);
  });

  return { areas, warnings };
};
