import { defineConfig } from "vite";
import cesium from "vite-plugin-cesium";

// vite-plugin-cesium 负责把 Cesium 的静态资源（Workers/Assets/Widgets）
// 拷贝到产物里并设置 CESIUM_BASE_URL，否则打包后地图不会渲染。
export default defineConfig({
  base: "./",
  plugins: [cesium()],
});
