// Context metadata type definitions for DTP

/** 硬件传感器来源 */
export interface HardwareSource {
  kind: 'hardware';
  sensorType: string;
  precision: string;
  samplingRate: number;
}

/** 软件来源 */
export interface SoftwareSource {
  kind: 'software';
  appIdentifier: string;
  sharingMethod: string;
}

/** 数据来源（硬件或软件） */
export type DataSource = HardwareSource | SoftwareSource;

/** 上下文元数据 */
export interface ContextMetadata {
  dataType: string;
  source: DataSource;
  customFields: Record<string, unknown>;
}
