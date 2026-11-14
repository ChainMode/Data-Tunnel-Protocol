// DAG-related type definitions for DTP

import type { FragmentID } from './frame.js';

/** DAG 关系类型 */
export type DAGRelationType = 'derived_from' | 'annotates' | 'supersedes';

/** DAG 依赖边 */
export interface DAGEdge {
  targetFragmentId: FragmentID;
  relationType: DAGRelationType;
}
