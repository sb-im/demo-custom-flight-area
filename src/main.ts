import "./style.css";
import * as Cesium from "cesium";

import { startDrawSession, type DrawMode, type DrawSession } from "./draw";
import { buildGeofenceFile, parseGeofenceFile } from "./geofenceFile";
import { distanceMeters, geometryFocus, geometryRing, polygonVertexCount } from "./geometry";
import { randomUUID } from "./hash";
import { areaColor, pickAreaId, renderAreas } from "./render";
import type { FlightArea, FlightAreaType } from "./types";
import { isCircle } from "./types";
import { validateFlightAreaGeometry } from "./validation";
import { createViewer, flyToArea } from "./viewer";

const AREA_TYPE_LABEL: Record<FlightAreaType, string> = {
  dfence: "作业区",
  nfz: "限飞区",
};

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`缺少 DOM 节点 #${id}`);
  return node as T;
};

const areaList = el<HTMLUListElement>("areaList");
const areaCount = el<HTMLSpanElement>("areaCount");
const emptyHint = el<HTMLParagraphElement>("emptyHint");
const fileInfo = el<HTMLDivElement>("fileInfo");
const drawPolygonBtn = el<HTMLButtonElement>("drawPolygon");
const drawCircleBtn = el<HTMLButtonElement>("drawCircle");
const importInput = el<HTMLInputElement>("importInput");
const toastNode = el<HTMLDivElement>("toast");

let areas: FlightArea[] = [];
let selectedAreaId: string | null = null;
let session: DrawSession | null = null;
let toastTimer = 0;

const toast = (text: string, ok = false) => {
  toastNode.textContent = text;
  toastNode.classList.toggle("ok", ok);
  toastNode.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastNode.hidden = true;
  }, 4000);
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"]/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char,
  );

const areaSummary = (area: FlightArea): string => {
  if (isCircle(area.geometry)) return `圆 · R${area.geometry.radius.toFixed(0)}m`;
  const ring = area.geometry.coordinates;
  const perimeter = ring
    .slice(1)
    .reduce((sum, point, index) => sum + distanceMeters(ring[index], point), 0);
  return `${polygonVertexCount(ring)} 顶点 · 周长 ${perimeter.toFixed(0)}m`;
};

const nextAreaName = (areaType: FlightAreaType) => {
  const used = areas.filter((area) => area.areaType === areaType).length;
  return `${AREA_TYPE_LABEL[areaType]}-${used + 1}`;
};

const selectedAreaType = (): FlightAreaType =>
  (document.querySelector<HTMLInputElement>('input[name="areaType"]:checked')?.value ??
    "dfence") as FlightAreaType;

const main = async () => {
  const { viewer, basemapError } = await createViewer(el<HTMLDivElement>("cesiumContainer"));
  if (basemapError) toast(basemapError);

  const refresh = () => {
    renderAreas(viewer, areas, selectedAreaId);
    areaCount.textContent = String(areas.length);
    emptyHint.hidden = areas.length > 0;
    areaList.innerHTML = "";
    areas.forEach((area) => {
      const item = document.createElement("li");
      item.className = `area-item${area.id === selectedAreaId ? " selected" : ""}`;
      item.innerHTML = `
        <span class="dot" style="background:${areaColor(area).toCssHexString()}"></span>
        <span class="name">${escapeHtml(area.name)}${area.enabled ? "" : "（已停用）"}</span>
        <span class="meta">${areaSummary(area)}</span>
        <button class="remove" type="button" title="删除">×</button>`;
      item.addEventListener("click", () => {
        selectedAreaId = area.id;
        const { center, radius } = geometryFocus(area.geometry);
        flyToArea(viewer, center, radius);
        refresh();
      });
      item.querySelector(".remove")?.addEventListener("click", (event) => {
        event.stopPropagation();
        areas = areas.filter((other) => other.id !== area.id);
        if (selectedAreaId === area.id) selectedAreaId = null;
        refresh();
      });
      areaList.appendChild(item);
    });
  };

  const stopDrawing = () => {
    session?.destroy();
    session = null;
    drawPolygonBtn.classList.remove("active");
    drawCircleBtn.classList.remove("active");
  };

  const startDrawing = (mode: DrawMode) => {
    const active = mode === "polygon" ? drawPolygonBtn : drawCircleBtn;
    const wasActive = active.classList.contains("active");
    stopDrawing();
    if (wasActive) return;

    const areaType = selectedAreaType();
    active.classList.add("active");
    session = startDrawSession({
      viewer,
      mode,
      color: areaType === "nfz" ? Cesium.Color.fromCssColorString("#ff3030")
        : Cesium.Color.fromCssColorString("#20df55"),
      // 绘制完成时立刻校验；导入文件走的是同一个函数
      validate: (geometry) => validateFlightAreaGeometry(geometry, areaType, areas),
      onFinish: (geometry) => {
        areas = [
          ...areas,
          {
            id: randomUUID(),
            name: nextAreaName(areaType),
            areaType,
            geometry,
            enabled: true,
          },
        ];
        stopDrawing();
        refresh();
        toast("区域已添加", true);
      },
      onCancel: () => stopDrawing(),
      onMessage: (text) => toast(text),
    });
  };

  drawPolygonBtn.addEventListener("click", () => startDrawing("polygon"));
  drawCircleBtn.addEventListener("click", () => startDrawing("circle"));

  // 地图上点选区域
  const clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  clickHandler.setInputAction((event: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    if (session) return;
    const id = pickAreaId(viewer, event.position);
    if (id) {
      selectedAreaId = id;
      refresh();
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  const flyToAll = () => {
    const positions = areas.flatMap((area) =>
      geometryRing(area.geometry).map(([lng, lat]) =>
        Cesium.Cartesian3.fromDegrees(lng, lat),
      ),
    );
    if (!positions.length) return;
    const sphere = Cesium.BoundingSphere.fromPoints(positions);
    viewer.camera.flyToBoundingSphere(sphere, {
      offset: new Cesium.HeadingPitchRange(
        0,
        Cesium.Math.toRadians(-90),
        Math.max(400, sphere.radius * 3),
      ),
      duration: 1,
    });
  };

  el("exportBtn").addEventListener("click", () => {
    if (!areas.length) {
      toast("还没有区域可导出");
      return;
    }
    let file: ReturnType<typeof buildGeofenceFile>;
    try {
      file = buildGeofenceFile(areas);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error));
      return;
    }
    const blob = new Blob([file.bytes], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.fileName;
    link.click();
    URL.revokeObjectURL(url);

    fileInfo.hidden = false;
    fileInfo.innerHTML = `
      <div><b>文件名</b> <code>${file.fileName}</code></div>
      <div><b>MD5</b>（用于文件名） <code>${file.md5}</code></div>
      <div><b>SHA256</b>（协议里的 checksum） <code>${file.sha256}</code></div>
      <div><b>大小</b> ${file.size} 字节 · ${areas.length} 个区域</div>
      <details><summary>查看 JSON</summary><pre>${escapeHtml(file.json)}</pre></details>`;
    toast(`已导出 ${file.fileName}`, true);
  });

  const loadText = (text: string, source: string) => {
    try {
      const { areas: parsed, warnings } = parseGeofenceFile(text);
      areas = parsed;
      selectedAreaId = null;
      refresh();
      flyToAll();
      fileInfo.hidden = false;
      fileInfo.innerHTML = `
        <div><b>${escapeHtml(source)}</b> 解析成功，共 ${parsed.length} 个区域</div>
        ${
          warnings.length
            ? `<ul>${warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
            : ""
        }`;
      toast(
        warnings.length
          ? `导入成功，有 ${warnings.length} 条提示`
          : `导入成功，共 ${parsed.length} 个区域`,
        true,
      );
    } catch (error) {
      toast(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  el("importBtn").addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    loadText(await file.text(), file.name);
    // 允许连续导入同一个文件
    importInput.value = "";
  });

  el("sampleBtn").addEventListener("click", async () => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}geofence-sample.json`);
      loadText(await response.text(), "示例文件");
    } catch (error) {
      toast(`示例加载失败：${error instanceof Error ? error.message : String(error)}`);
    }
  });

  el("clearBtn").addEventListener("click", () => {
    if (!areas.length) return;
    if (!window.confirm(`确定清空全部 ${areas.length} 个区域？`)) return;
    areas = [];
    selectedAreaId = null;
    fileInfo.hidden = true;
    refresh();
  });

  refresh();
};

void main();
