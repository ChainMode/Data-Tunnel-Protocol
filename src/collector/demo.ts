/**
 * Runnable E2E Demo for `dtp-collector`:
 *  1. Flow 1 (`Terminal -> iFay` Contextual Collection): creates an ephemeral local workspace
 *     of personal notes, attaches contextual metadata, negotiates a DTP 1.0 collection session,
 *     and commits AES-256-GCM + RFC 8785 JCS wire frames into a Personal Data Heap.
 *  2. Flow 2 (`iFay -> App` Privacy-Filtered Minimal Data Injection): an external dining &
 *     scheduling app requests both approved preferences and raw/sensitive fields; iFay strips
 *     all raw prose, paths, identifiers, and unapproved fields and injects ONLY the minimal
 *     approved projection over an encrypted DTP 1.0 frame.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PersonalDataHeap,
  collectWorkspaceToHeap,
  deriveCollectorKeyFromHexOrPassphrase,
  requestMinimalContextFromIfay,
} from './personal-context-collector.js';

export interface DtpCollectorDemoReport {
  collection: {
    sessionId: string;
    agreementId: string;
    scannedFiles: number;
    committedFrames: number;
    zeroPlaintextOnDisk: boolean;
    ambientMetadataSample: Record<string, unknown>;
  };
  minimalInjection: {
    approved: boolean;
    appId: string;
    injectedFields: Record<string, unknown>;
    withheldFields: string[];
    strippedProtectedFields: string[];
    wireFrameBytes: number;
  };
}

function writeNoteFile(dir: string, name: string, content: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), content, 'utf8');
}

export function runDtpCollectorDemo(options?: { silent?: boolean }): DtpCollectorDemoReport {
  const tempRoot = mkdtempSync(join(tmpdir(), 'dtp-collector-demo-'));
  try {
    const workspaceDir = join(tempRoot, 'notes');
    const heapDir = join(tempRoot, 'personal-data-heap');
    const heapKey = deriveCollectorKeyFromHexOrPassphrase('demo-ifay-heap-master-secret');
    const appTunnelKey = deriveCollectorKeyFromHexOrPassphrase('demo-ephemeral-app-tunnel-secret');

    writeNoteFile(
      workspaceDir,
      'daily-preferences.md',
      [
        '---',
        'dietary_preference: vegetarian_no_peanuts',
        'schedule_window: "19:00-20:30"',
        'preferred_language: zh-CN',
        'medical_allergy_detail: confidential-anaphylaxis-history-001',
        'human_prime_id: human_secretprime23456789',
        '---',
        '# Evening Study & Dining Notes',
        '',
        'Private reflection: reviewing Batch 2 architecture before dinner.',
      ].join('\n'),
    );

    writeNoteFile(
      workspaceDir,
      'architecture-reading.md',
      [
        '# Protocol Reading Log',
        '- focus_mode: deep_work',
        '- coffee_order: oat_flat_white',
        '',
        'Raw private draft that external apps must NEVER receive.',
      ].join('\n'),
    );

    const collectionRes = collectWorkspaceToHeap({
      workspaceDir,
      heapDir,
      sessionKey: heapKey,
      ownerFayId: 'ifay_democollector23456789',
      terminalDeviceId: 'host_macbook_pro_m4',
      ambientContext: {
        timestamp: '2026-11-20T19:00:00.000Z',
        timezone: 'Asia/Shanghai',
        ambient_activity: 'deep_work',
        device_class: 'laptop_workstation',
        source_app: 'obsidian-vault',
      },
    });

    const heap = new PersonalDataHeap(heapDir);
    const firstFrameDiskBytes = readFileSync(
      join(heapDir, collectionRes.heapManifest.frames[0].frameFile),
    );
    const rawDiskString = firstFrameDiskBytes.toString('utf8');
    const zeroPlaintextOnDisk =
      !rawDiskString.includes('vegetarian_no_peanuts') &&
      !rawDiskString.includes('Private reflection');

    const decryptedEntries = heap.readDecryptedEntries(heapKey);

    const injectionRes = requestMinimalContextFromIfay(
      { heap, heapSessionKey: heapKey },
      {
        appId: 'bistro-table-booker',
        purpose: 'dinner_reservation_personalization',
        requestedFields: [
          'dietary_preference',
          'schedule_window',
          'medical_allergy_detail',
          'text',
          'human_prime_id',
          'source_rel_path',
        ],
        appSessionKey: appTunnelKey,
      },
      {
        approvedFields: ['dietary_preference', 'schedule_window'],
        allowedPurposes: ['dinner_reservation_personalization'],
      },
      { nowIso: '2026-11-20T19:05:00.000Z' },
    );

    const report: DtpCollectorDemoReport = {
      collection: {
        sessionId: collectionRes.sessionId,
        agreementId: collectionRes.agreementId,
        scannedFiles: collectionRes.scannedFiles,
        committedFrames: collectionRes.committedFrames,
        zeroPlaintextOnDisk,
        ambientMetadataSample: decryptedEntries[0].payload.context_metadata,
      },
      minimalInjection: {
        approved: injectionRes.approved,
        appId: injectionRes.appId,
        injectedFields: injectionRes.injectedFields,
        withheldFields: injectionRes.withheldFields,
        strippedProtectedFields: injectionRes.strippedProtectedFields,
        wireFrameBytes: injectionRes.wireFrame?.byteLength ?? 0,
      },
    };

    if (!options?.silent) {
      console.log('=== DTP 1.0 Personal Context Collector & Minimal Injection Demo ===');
      console.log(JSON.stringify(report, null, 2));
    }
    return report;
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
