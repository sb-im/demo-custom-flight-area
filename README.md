# 自定义飞行区绘制 Demo — SuperDock M400

> [在线体验](https://sb-im.github.io/demo-custom-flight-area/) · [English](./README.en.md)

这是一个面向 [草莓创新 StrawBerry Innovation](https://sb.im) **SuperDock M400 自动机场**的
自定义飞行区绘制 demo：在地图上绘制作业区与限飞区，导入或导出
`geofence_{md5}.json`。本项目生成的文件已经在真实 SuperDock M400 上验证可用。

文件格式遵循 DJI 上云 API 的自定义飞行区协议，也可以作为对接 DJI 机场的参考；具体机型与
固件支持范围请以 DJI 官方文档为准。

- **作业区 `dfence`**：飞行器只能在区域内作业，不能飞出边界。
- **限飞区 `nfz`**：飞行器不能进入该区域，可以在区域外作业。

本项目只包含绘制、校验和文件导入导出，不包含账号、后端、对象存储、MQTT 或设备同步逻辑。

## 快速开始

需要 Node.js 20。

```bash
npm ci
npm run dev        # http://localhost:5173
npm test           # 单元测试
npm run build      # 类型检查 + 生产构建，产物在 dist/
```

### 底图

底图使用 Cesium World Imagery。CesiumJS 自带的演示 token 无需配置即可体验，但只适合评估，
公开或生产环境请使用自己的 Cesium ion token：

```bash
cp .env.example .env.local
# 在 .env.local 中设置 VITE_CESIUM_ION_TOKEN
```

使用演示 token 时，页面底部会显示 Cesium 的提示条。更换影像源时，必须确保影像与 WGS84
坐标对齐；如果上游使用 GCJ-02 或 BD-09，需要在写入文件前完成坐标转换。

## 使用方法

| 操作 | 说明 |
| --- | --- |
| 选择区域类型 | 选择“作业区 `dfence`”或“限飞区 `nfz`” |
| 绘制多边形 | 左键逐点绘制，双击或右键结束，`Esc` 取消 |
| 绘制圆形 | 左键确定圆心，移动鼠标查看半径，再次左键完成 |
| 选择区域 | 点击地图上的区域，或点击左侧列表项 |
| 删除区域 | 点击列表项右侧的 `×` |
| 导出 JSON | 下载文件，并显示文件名、MD5、SHA-256、字节数和完整 JSON |
| 导入 JSON | 导入并显示已有文件，整体替换当前区域列表 |
| 加载示例 | 加载内置示例文件 |
| 清空 | 删除当前全部区域 |

## 复用到自己的项目

如果使用 AI 辅助集成，请先让编码助手阅读 [AGENTS.md](./AGENTS.md)，并只复制需要的层：

| 目标 | 文件 | 运行时依赖 |
| --- | --- | --- |
| 构建或解析飞行区文件 | `src/types.ts`、`src/geometry.ts`、`src/validation.ts`、`src/geofenceFile.ts`、`src/hash.ts` | 无第三方依赖；现代 TypeScript/ES2022 |
| 增加地图绘制 | 上述文件，加上 `src/draw.ts`、`src/render.ts`、`src/viewer.ts` | Cesium |
| 参考示例 UI | 再参考 `src/main.ts`、`index.html`、`src/style.css` | 浏览器 DOM、Cesium |

第一层的五个核心文件不依赖 Cesium 或 DOM，可以复用到 React、Vue 或 Node.js 项目。调用方仍需
根据自身模块系统调整导入路径，并负责把 GCJ-02、BD-09 等上游坐标转换为 WGS84。

## 文件格式

文件是一个 GeoJSON `FeatureCollection`。下面为了阅读进行了换行，实际导出为无 BOM 的紧凑
UTF-8 JSON：

```json
{"type":"FeatureCollection","features":[
  {"id":"9b860a40-0096-4ab4-b3f8-8bfc0689c00b","type":"Feature","geofence_type":"dfence",
   "geometry":{"type":"Point","coordinates":[114.2245,22.6857]},
   "properties":{"subType":"Circle","radius":198,"enable":true}},
  {"id":"0d14f28c-c147-4bd0-9107-496923f9f2ca","type":"Feature","geofence_type":"nfz",
   "geometry":{"type":"Polygon","coordinates":[[[114.2253,22.6872],[114.2259,22.6869],[114.2256,22.6865],[114.2251,22.6868],[114.2253,22.6872]]]},
   "properties":{"radius":0,"enable":true}}]}
```

| 字段 | 说明 |
| --- | --- |
| `id` | 稳定的区域唯一 ID，建议使用 UUID；设备上报时通过它引用区域 |
| `geofence_type` | `dfence`（作业区）或 `nfz`（限飞区） |
| `geometry.type` | 圆形为 `Point`，多边形为 `Polygon` |
| `properties.subType` | 圆形必须为 `"Circle"`；多边形不包含该字段 |
| `properties.radius` | 圆形半径，单位米；多边形为 `0` |
| `properties.enable` | 本 demo 固定导出 `true` |
| `coordinates` | WGS84 `[经度, 纬度]`；多边形为一个闭合外环 |

### 协议要求

1. 文件名必须是 `geofence_{文件 MD5}.json`，MD5 根据最终文件字节计算。
2. `flight_areas_get` 中的 `files[].checksum` 是同一文件的 **SHA-256**，不能与文件名中的
   MD5 混用；`files[].size` 是字节数。
3. 圆形必须使用 `Point` + `properties.subType = "Circle"`，半径不能小于 10 m。
4. 多边形外环必须首尾闭合，至少包含 3 个不同顶点，闭环后最多 255 个点。
5. 坐标必须是 WGS84 `[经度, 纬度]`。
6. 当前协议版本不支持关闭区域，因此导出固定写入 `properties.enable = true`。

MD5、SHA-256 和 `size` 必须基于最终上传的同一组字节计算。改变空白、字段顺序或编码后，必须
重新计算这些值。官方协议模板包含用于说明的 `//` 注释，不能直接作为 JSON 导入。为降低设备
固件兼容风险，本 demo 只导出文档定义的字段；区域名称、时间戳等业务元数据应通过稳定的 `id`
另行保存。

### Demo 校验策略与不支持范围

- 多边形不能自相交。
- 作业区之间不能重叠；限飞区可以位于作业区内，本 demo 不限制限飞区之间的重叠。
- `validateFlightAreaGeometry()` 是统一的语义校验入口，`buildGeofenceFile()` 会在导出前再次
  校验，避免绕过 UI 直接生成非法文件。
- 导入以查看和兼容常见文件为目标，不是无损转换。不支持的要素会被跳过或简化并给出提示，
  重新导出时不会恢复。
- 不支持多边形内环、MultiPolygon、禁降区、高度范围和 `features_extend`。
- 距离与自相交判定直接在经纬度平面上计算，适用于一般作业尺度；不处理跨 180° 经线或极区。

## 接入注意事项

- 机场必须位于某个作业区内部、所有限飞区外部，并与边界保留安全余量，否则飞行器可能无法
  起飞。本 demo 没有机场位置数据，接入系统应在同步前完成这项检查。
- `buildGeofenceFile()` 按 `id` 排序并稳定序列化。同一组区域会生成相同字节和摘要，避免
  语义未变化时产生新的文件标识。
- 本项目只生成文件。上传、通知机场、同步进度和任务安全预检查请按对应设备的官方文档实现。

## 参考文档

- [SuperDock 自定义飞行区接口](https://docs.sb.im/api-integration/api-reference/superdock-hangar/custom-flight-area)
- [DJI 上云 API：自定义飞行区](https://developer.dji.com/doc/cloud-api-tutorial/cn/feature-set/dock-feature-set/custom-flight-area.html)
- [DJI 自定义飞行区文件协议模板](https://terra-1-g.djicdn.com/fee90c2e03e04e8da67ea6f56365fc76/SDK%20%E6%96%87%E6%A1%A3/CloudAPI/custom-flight-area-file-template.json)
- [Cesium ion Access Tokens](https://cesium.com/learn/ion/cesium-ion-access-tokens/)

## 许可证

本项目基于 [MIT License](./LICENSE) 开源。
