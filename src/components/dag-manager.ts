// DTP DAG Manager Implementation
// Manages Fragment DAG dependencies, cycle detection, and pending fragment resolution.

import type { DAGManager, DAGValidationResult, DependencyResolutionResult } from '../types/components.js';
import type { Fragment } from '../types/fragment.js';
import type { FragmentID } from '../types/frame.js';
import type { DAGEdge } from '../types/dag.js';

export class DTPDAGManager implements DAGManager {
  /** All accepted fragments by ID */
  private readonly fragments = new Map<FragmentID, Fragment>();

  /** Edges: fragmentId -> its declared dependencies */
  private readonly edges = new Map<FragmentID, DAGEdge[]>();

  /** Reverse index: targetFragmentId -> list of fragments that depend on it */
  private readonly reverseEdges = new Map<FragmentID, Set<FragmentID>>();

  /** Fragments waiting for unresolved dependencies */
  private readonly pending = new Map<FragmentID, Fragment>();

  /** Unresolved deps for each pending fragment */
  private readonly pendingDeps = new Map<FragmentID, Set<FragmentID>>();

  addFragment(fragment: Fragment): DAGValidationResult {
    const { fragmentId, dagDependencies } = fragment;

    // Check for cycles if there are dependencies
    if (dagDependencies.length > 0) {
      if (!this.validateAcyclicity(fragmentId, dagDependencies)) {
        return { status: 'rejected', reason: 'cycle_detected' };
      }
    }

    // Determine which dependencies are unresolved
    const unresolvedDeps: FragmentID[] = [];
    for (const edge of dagDependencies) {
      if (!this.fragments.has(edge.targetFragmentId)) {
        unresolvedDeps.push(edge.targetFragmentId);
      }
    }

    if (unresolvedDeps.length > 0) {
      // Cache as pending
      this.pending.set(fragmentId, fragment);
      this.pendingDeps.set(fragmentId, new Set(unresolvedDeps));
      return { status: 'pending', unresolvedDeps };
    }

    // Accept the fragment
    this.acceptFragment(fragment);

    // Check if any pending fragments can now be resolved
    this.tryResolvePending(fragmentId);

    return { status: 'accepted' };
  }

  validateAcyclicity(fragmentId: FragmentID, dependencies: DAGEdge[]): boolean {
    // DFS-based cycle detection.
    // We check if any dependency path from the new fragment leads back to itself.
    // Build a temporary adjacency including the new edges, then DFS from fragmentId's
    // dependency targets to see if any path reaches fragmentId.

    const targetIds = dependencies.map(e => e.targetFragmentId);

    // If the fragment depends on itself, that's a cycle
    if (targetIds.includes(fragmentId)) {
      return false;
    }

    // DFS: starting from each target, follow existing edges to see if we reach fragmentId
    const visited = new Set<FragmentID>();

    const hasCycle = (current: FragmentID): boolean => {
      if (current === fragmentId) return true;
      if (visited.has(current)) return false;
      visited.add(current);

      const deps = this.edges.get(current);
      if (!deps) return false;

      for (const edge of deps) {
        if (hasCycle(edge.targetFragmentId)) return true;
      }
      return false;
    };

    for (const targetId of targetIds) {
      // Only check existing (accepted) fragments for cycles
      if (this.fragments.has(targetId)) {
        visited.clear();
        if (hasCycle(targetId)) return false;
      }
    }

    return true;
  }

  resolveDependencies(fragmentId: FragmentID): DependencyResolutionResult {
    // Check if fragment is pending
    const unresolvedSet = this.pendingDeps.get(fragmentId);
    if (!unresolvedSet) {
      // Fragment is either accepted or unknown
      const deps = this.edges.get(fragmentId) ?? [];
      return {
        resolved: true,
        resolvedDeps: deps.map(e => e.targetFragmentId),
        unresolvedDeps: [],
      };
    }

    const fragment = this.pending.get(fragmentId)!;
    const allDeps = fragment.dagDependencies.map(e => e.targetFragmentId);
    const unresolved = [...unresolvedSet];
    const resolved = allDeps.filter(id => !unresolvedSet.has(id));

    return {
      resolved: unresolvedSet.size === 0,
      resolvedDeps: resolved,
      unresolvedDeps: unresolved,
    };
  }

  getDependencies(fragmentId: FragmentID): DAGEdge[] {
    // Check accepted fragments first, then pending
    const edges = this.edges.get(fragmentId);
    if (edges) return [...edges];

    const pendingFragment = this.pending.get(fragmentId);
    if (pendingFragment) return [...pendingFragment.dagDependencies];

    return [];
  }

  getDependents(fragmentId: FragmentID): FragmentID[] {
    const dependents = this.reverseEdges.get(fragmentId);
    return dependents ? [...dependents] : [];
  }

  getPendingFragments(): Fragment[] {
    return [...this.pending.values()];
  }

  /** Accept a fragment into the DAG */
  private acceptFragment(fragment: Fragment): void {
    const { fragmentId, dagDependencies } = fragment;

    this.fragments.set(fragmentId, fragment);
    this.edges.set(fragmentId, [...dagDependencies]);

    // Update reverse edges
    for (const edge of dagDependencies) {
      let set = this.reverseEdges.get(edge.targetFragmentId);
      if (!set) {
        set = new Set();
        this.reverseEdges.set(edge.targetFragmentId, set);
      }
      set.add(fragmentId);
    }
  }

  /** After accepting a fragment, check if any pending fragments can now be resolved */
  private tryResolvePending(newlyAcceptedId: FragmentID): void {
    const toResolve: FragmentID[] = [];

    for (const [pendingId, unresolvedSet] of this.pendingDeps) {
      unresolvedSet.delete(newlyAcceptedId);
      if (unresolvedSet.size === 0) {
        toResolve.push(pendingId);
      }
    }

    for (const pendingId of toResolve) {
      const fragment = this.pending.get(pendingId)!;
      this.pending.delete(pendingId);
      this.pendingDeps.delete(pendingId);

      // Validate acyclicity before accepting (dependencies may have changed the graph)
      if (this.validateAcyclicity(pendingId, fragment.dagDependencies)) {
        this.acceptFragment(fragment);
        // Recursively check if more pending fragments can be resolved
        this.tryResolvePending(pendingId);
      }
      // If cycle detected during resolution, silently drop (already was pending)
    }
  }
}
