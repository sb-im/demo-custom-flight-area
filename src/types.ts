/** 经纬度坐标，WGS84，顺序为 [经度, 纬度]（与 GeoJSON 一致） */
export type Coordinate = [number, number];

/** dfence = 作业区（只有区域内才允许飞行）；nfz = 限飞区（不能飞进去） */
export type FlightAreaType = "dfence" | "nfz";

export interface CircleGeometry {
  center: Coordinate;
  /** 米 */
  radius: number;
}

export interface PolygonGeometry {
  /** 闭环存储：末点 === 首点 */
  coordinates: Coordinate[];
}

export type FlightAreaGeometry = CircleGeometry | PolygonGeometry;

export const isCircle = (geometry: FlightAreaGeometry): geometry is CircleGeometry =>
  "center" in geometry;

export interface FlightArea {
  /** 上报告警时机场用它回指区域，必须全局唯一且稳定，本 demo 用 UUID */
  id: string;
  /** 仅本地展示用，不写入自定义飞行区文件 */
  name: string;
  areaType: FlightAreaType;
  geometry: FlightAreaGeometry;
  /** 对应文件里的 properties.enable */
  enabled: boolean;
}
