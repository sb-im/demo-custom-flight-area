import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

/**
 * 卫星底图用 Cesium ion 的全球影像（Cesium World Imagery）。
 *
 * 不配任何东西也能显示：CesiumJS 内置了 Cesium 官方的演示 ion token，
 * Sandcastle 就是这么跑的。但那是 Cesium 自己的额度，**仅供体验**，随时可能
 * 限流或失效。自己的项目请去 https://ion.cesium.com/ 注册免费的 Community
 * 账号，拿自己的 token 填到 .env.local 的 VITE_CESIUM_ION_TOKEN。
 *
 * 只用影像，不用 ion 的其它服务：
 * - geocoder / baseLayerPicker 关掉（会额外请求 ion 与 Bing 的地名/底图列表）；
 * - 不传 terrain，Viewer 使用椭球地形（不请求 ion 的全球地形）。
 *
 * 换成别的影像源时**必须是 WGS84 对齐的**：高德/腾讯/百度，以及各家的街道图，
 * 多为 GCJ-02 / BD-09 坐标系，在中国区有几百米偏移，不纠偏就取点会把飞行区
 * 画错位置。
 */

const ionToken = (import.meta.env.VITE_CESIUM_ION_TOKEN ?? "").trim();
if (ionToken) Cesium.Ion.defaultAccessToken = ionToken;

/** 初始视角：与 public/geofence-sample.json 示例文件同一区域 */
const DEFAULT_VIEW = {
  longitude: 114.2249,
  latitude: 22.6862,
  height: 1200,
};

export const createViewer = async (container: HTMLElement) => {
  // 底图取不到时不能让页面挂掉：绘制、校验、导入导出都不依赖底图，
  // 内网环境下没有影像照样可以把飞行区文件做出来。
  let baseLayer: Cesium.ImageryLayer | false = false;
  let basemapError: string | null = null;
  try {
    baseLayer = new Cesium.ImageryLayer(await Cesium.createWorldImageryAsync());
  } catch (error) {
    basemapError = `卫星底图加载失败（${
      error instanceof Error ? error.message : String(error)
    }），不影响绘制与导入导出`;
  }

  const viewer = new Cesium.Viewer(container, {
    baseLayer,
    baseLayerPicker: false,
    geocoder: false,
    animation: false,
    timeline: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    selectionIndicator: false,
    infoBox: false,
  });

  // 双击默认会锁定并跟随实体，会干扰"双击结束绘制"
  viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(
    Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
  );

  viewer.scene.globe.showGroundAtmosphere = false;
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#1b2430");
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(
      DEFAULT_VIEW.longitude,
      DEFAULT_VIEW.latitude,
      DEFAULT_VIEW.height,
    ),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
  });

  return { viewer, basemapError };
};

/** 屏幕坐标 -> 地表经纬度；返回 null 表示点在天空上 */
export const pickCoordinate = (
  viewer: Cesium.Viewer,
  position: Cesium.Cartesian2,
): [number, number] | null => {
  const ray = viewer.camera.getPickRay(position);
  const cartesian = ray
    ? viewer.scene.globe.pick(ray, viewer.scene)
    : viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid);
  if (!cartesian) return null;
  const carto = Cesium.Cartographic.fromCartesian(cartesian);
  return [Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude)];
};

/** 飞到指定中心，视野按半径自适应 */
export const flyToArea = (
  viewer: Cesium.Viewer,
  center: [number, number],
  radius: number,
) => {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      center[0],
      center[1],
      Math.max(300, radius * 4),
    ),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    duration: 0.8,
  });
};
