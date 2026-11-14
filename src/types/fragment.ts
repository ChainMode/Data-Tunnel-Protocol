// Fragment-related type definitions for DTP

import type { FragmentID, AgreementID, OriginTimestamp } from './frame.js';
import type { ContextMetadata } from './context-metadata.js';
import type { DAGEdge } from './dag.js';

/** 数据片段 */
export interface Fragment {
  fragmentId: FragmentID;
  agreementId: AgreementID;
  originTimestamp: OriginTimestamp;
  contextMetadata: ContextMetadata;
  dagDependencies: DAGEdge[];
  data: Uint8Array;
}
