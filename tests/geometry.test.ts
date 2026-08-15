import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  closedRing,
  distanceMeters,
  geometriesOverlap,
  polygonSelfIntersects,
  polygonVertexCount,
} from "../src/geometry";
import { md5, sha256 } from "../src/hash";
import { buildGeofenceFile, parseGeofenceFile } from "../src/geofenceFile";
import type { Coordinate, FlightArea } from "../src/types";
import { validateFlightAreaGeometry } from "../src/validation";

const square: Coordinate[] = [
  [114.0, 22.0],
  [114.001, 22.0],
  [114.001, 22.001],
  [114.0, 22.001],
];

const area = (
  id: string,
  areaType: FlightArea["areaType"],
  geometry: FlightArea["geometry"],
): FlightArea => ({
  id,
  name: id,
  areaType,
  geometry,
  enabled: true,
});

describe("hash", () => {
  const encode = (text: string) => new TextEncoder().encode(text);

  it("匹配 MD5 标准测试向量", () => {
    expect(md5(encode(""))).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5(encode("abc"))).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5(encode("The quick brown fox jumps over the lazy dog"))).toBe(
      "9e107d9d372bb6826bd81d3542a419d6",
    );
    // 跨块（>55 字节）确保长度填充正确
    expect(md5(encode("a".repeat(1000)))).toBe("cabe45dcc9ae5b66ba86600cca6b8ba8");
  });

  it("匹配 SHA-256 标准测试向量", () => {
    expect(sha256(encode(""))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256(encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256(encode("a".repeat(1000)))).toBe(
      "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3",
    );
  });
});

describe("geometry", () => {
  it("按米计算距离", () => {
    expect(distanceMeters([114, 22], [114, 22.001])).toBeCloseTo(111.2, 0);
  });

  it("闭环归一化并去掉重复点", () => {
    expect(closedRing(square)).toHaveLength(5);
    expect(closedRing([...square, square[0]])).toHaveLength(5);
    expect(polygonVertexCount([...square, square[0]])).toBe(4);
  });

  it("识别自相交多边形", () => {
    expect(polygonSelfIntersects(square)).toBe(false);
    // 交换两个顶点得到「蝴蝶结」
    const bowtie: Coordinate[] = [square[0], square[1], square[3], square[2]];
    expect(polygonSelfIntersects(bowtie)).toBe(true);
  });

  it("判定圆与圆、圆与多边形、多边形与多边形的重叠", () => {
    expect(
      geometriesOverlap({ center: [114, 22], radius: 100 }, { center: [114, 22.001], radius: 50 }),
    ).toBe(true);
    expect(
      geometriesOverlap({ center: [114, 22], radius: 20 }, { center: [114, 22.001], radius: 50 }),
    ).toBe(false);
    // 圆心在多边形外但边界伸进去
    expect(
      geometriesOverlap({ center: [113.9995, 22.0005], radius: 100 }, { coordinates: square }),
    ).toBe(true);
    // 完全包含（无边相交）
    const inner: Coordinate[] = [
      [114.0002, 22.0002],
      [114.0008, 22.0002],
      [114.0008, 22.0008],
      [114.0002, 22.0008],
    ];
    expect(geometriesOverlap({ coordinates: square }, { coordinates: inner })).toBe(true);
  });

  it("非相邻边接触也算自相交", () => {
    const touching: Coordinate[] = [
      [114.0, 22.0],
      [114.002, 22.0],
      [114.002, 22.002],
      [114.001, 22.0], // 落在第一条边上
      [114.0, 22.002],
    ];
    expect(polygonSelfIntersects(touching)).toBe(true);
  });

});

describe("validation", () => {
  it("拒绝半径不足 10 米的圆", () => {
    expect(validateFlightAreaGeometry({ center: [114, 22], radius: 9.9 }, "nfz", [])).toMatch(
      /10 米/,
    );
    expect(validateFlightAreaGeometry({ center: [114, 22], radius: 10 }, "nfz", [])).toBeNull();
  });

  it("拒绝顶点不足或超出坐标范围的多边形", () => {
    expect(
      validateFlightAreaGeometry({ coordinates: [[114, 22], [114.001, 22]] }, "nfz", []),
    ).toMatch(/至少/);
    expect(
      validateFlightAreaGeometry({ coordinates: [...square, [200, 22] as Coordinate] }, "nfz", []),
    ).toMatch(/WGS84/);
  });

  it("拒绝作业区之间重叠，但不限制限飞区", () => {
    const existing = [area("a", "dfence", { coordinates: closedRing(square) })];
    const overlapping = { center: [114.0005, 22.0005] as Coordinate, radius: 50 };
    expect(validateFlightAreaGeometry(overlapping, "dfence", existing)).toMatch(/重叠/);
    expect(validateFlightAreaGeometry(overlapping, "nfz", existing)).toBeNull();
  });

  it("编辑自身时不与自己判重叠", () => {
    const geometry = { coordinates: closedRing(square) };
    const existing = [area("a", "dfence", geometry)];
    expect(validateFlightAreaGeometry(geometry, "dfence", existing, "a")).toBeNull();
  });
});

describe("geofence 文件", () => {
  const areas = [
    area("00000000-0000-0000-0000-000000000002", "nfz", {
      coordinates: closedRing(square),
    }),
    area("00000000-0000-0000-0000-000000000001", "dfence", {
      center: [114.2, 22.6],
      radius: 198,
    }),
  ];

  it("按 id 排序、紧凑输出且文件名带内容 MD5", () => {
    const file = buildGeofenceFile(areas);
    expect(file.json).not.toContain("\n");
    expect(file.json.startsWith('{"type":"FeatureCollection"')).toBe(true);
    expect(file.fileName).toBe(`geofence_${file.md5}.json`);
    expect(file.md5).toHaveLength(32);
    expect(file.sha256).toHaveLength(64);
    // 确定性：同样的区域集合（顺序不同）产出同样的字节
    expect(buildGeofenceFile([...areas].reverse()).json).toBe(file.json);
    const parsed = JSON.parse(file.json);
    expect(parsed.features[0].id).toBe("00000000-0000-0000-0000-000000000001");
    expect(parsed.features[0].geometry.type).toBe("Point");
    expect(parsed.features[0].properties.subType).toBe("Circle");
    expect(parsed.features[1].geometry.coordinates[0][0]).toEqual(
      parsed.features[1].geometry.coordinates[0].at(-1),
    );
  });

  it("导出时固定启用区域并拒绝不合法几何", () => {
    const disabled = { ...areas[0], enabled: false };
    const parsed = JSON.parse(buildGeofenceFile([disabled]).json);
    expect(parsed.features[0].properties.enable).toBe(true);

    expect(() =>
      buildGeofenceFile([
        area("invalid", "nfz", { center: [114.2, 22.6], radius: 9.9 }),
      ]),
    ).toThrow(/无法导出.*半径不得小于 10 米/);
  });

  it("导入导出可往返", () => {
    const file = buildGeofenceFile(areas);
    const { areas: parsed, warnings } = parseGeofenceFile(file.json);
    expect(warnings).toHaveLength(0);
    expect(parsed).toHaveLength(2);
    expect(buildGeofenceFile(parsed).md5).toBe(file.md5);
  });

  it("解析示例文件", () => {
    const text = readFileSync(new URL("../public/geofence-sample.json", import.meta.url), "utf8");
    const { areas: parsed, warnings } = parseGeofenceFile(text);
    expect(parsed).toHaveLength(2);
    expect(parsed.filter((item) => item.areaType === "dfence")).toHaveLength(1);
    expect(warnings).toHaveLength(0);
  });

  it("跳过不支持的要素并给出警告", () => {
    const { areas: parsed, warnings } = parseGeofenceFile(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            id: "keep",
            type: "Feature",
            geofence_type: "nfz",
            geometry: { type: "Point", coordinates: [114, 22] },
            properties: { subType: "Circle", radius: 100, enable: true },
          },
          { id: "drop", type: "Feature", geofence_type: "unknown", geometry: {} },
        ],
        features_extend: [{ id: "ext", type: "Feature" }],
      }),
    );
    expect(parsed).toHaveLength(1);
    expect(warnings).toHaveLength(2);
  });

  it("导入带注释的协议模板时给出可读错误", () => {
    expect(() => parseGeofenceFile('//协议版本\n{"type":"FeatureCollection","features":[]}')).toThrow(
      /注释/,
    );
  });

  it("拒绝结构不合法的文件", () => {
    expect(() => parseGeofenceFile('{"type":"Feature"}')).toThrow(/FeatureCollection/);
    expect(() => parseGeofenceFile('{"type":"FeatureCollection"}')).toThrow(/features/);
  });
});
