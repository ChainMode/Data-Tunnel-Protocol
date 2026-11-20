#!/usr/bin/env node
/**
 * `dtp-collector` CLI — Official DTP 1.0 Personal Context Collector & Minimal Injection Tool
 */

import { parseArgs } from 'node:util';
import {
  PersonalDataHeap,
  collectWorkspaceToHeap,
  deriveCollectorKeyFromHexOrPassphrase,
  requestMinimalContextFromIfay,
  watchWorkspaceToHeap,
} from './personal-context-collector.js';
import { runDtpCollectorDemo } from './demo.js';

const USAGE = `Usage:
  dtp-collector demo
  dtp-collector collect --workspace <dir> --heap <dir> [--key <hex-or-secret>] [--timezone <tz>] [--activity <act>] [--device <cls>] [--app <id>]
  dtp-collector watch   --workspace <dir> --heap <dir> [--key <hex-or-secret>] [--duration-ms <ms>]
  dtp-collector inspect --heap <dir> --key <hex-or-secret>
  dtp-collector inject  --heap <dir> --key <hex-or-secret> --app-id <id> --purpose <str> --request <f1,f2> --allow <f1>
`;

export async function runDtpCollectorCli(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  const command = argv[0];
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    console.log(USAGE);
    return 0;
  }

  if (command === 'demo') {
    runDtpCollectorDemo();
    return 0;
  }

  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      workspace: { type: 'string' },
      heap: { type: 'string' },
      key: { type: 'string' },
      timezone: { type: 'string' },
      activity: { type: 'string' },
      device: { type: 'string' },
      app: { type: 'string' },
      'duration-ms': { type: 'string' },
      'app-id': { type: 'string' },
      purpose: { type: 'string' },
      request: { type: 'string' },
      allow: { type: 'string' },
    },
    strict: false,
  });

  const secret = String(values.key ?? 'default-dev-dtp-collector-secret');
  const sessionKey = deriveCollectorKeyFromHexOrPassphrase(secret);

  if (command === 'collect') {
    if (!values.workspace || !values.heap) {
      console.error('Error: --workspace and --heap are required for `collect`');
      return 1;
    }
    const res = collectWorkspaceToHeap({
      workspaceDir: String(values.workspace),
      heapDir: String(values.heap),
      sessionKey,
      ambientContext: {
        timezone: values.timezone ? String(values.timezone) : undefined,
        ambient_activity: values.activity ? String(values.activity) : undefined,
        device_class: values.device ? String(values.device) : undefined,
        source_app: values.app ? String(values.app) : undefined,
      },
    });
    console.log(
      JSON.stringify(
        {
          sessionId: res.sessionId,
          agreementId: res.agreementId,
          scannedFiles: res.scannedFiles,
          committedFrames: res.committedFrames,
          totalHeapFrames: res.heapManifest.frame_count,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (command === 'watch') {
    if (!values.workspace || !values.heap) {
      console.error('Error: --workspace and --heap are required for `watch`');
      return 1;
    }
    const handle = watchWorkspaceToHeap({
      workspaceDir: String(values.workspace),
      heapDir: String(values.heap),
      sessionKey,
      onCommit: (res) => {
        console.log(
          JSON.stringify({
            event: 'dtp_heap_commit',
            committedFrames: res.committedFrames,
            totalHeapFrames: res.heapManifest.frame_count,
          }),
        );
      },
    });
    const durationMs = values['duration-ms'] ? Number(values['duration-ms']) : 0;
    if (durationMs > 0) {
      await new Promise((r) => setTimeout(r, durationMs));
      handle.close();
      return 0;
    }
    process.on('SIGINT', () => {
      handle.close();
      process.exit(0);
    });
    return 0;
  }

  if (command === 'inspect') {
    if (!values.heap) {
      console.error('Error: --heap is required for `inspect`');
      return 1;
    }
    const heap = new PersonalDataHeap(String(values.heap));
    const entries = heap.readDecryptedEntries(sessionKey);
    console.log(
      JSON.stringify(
        entries.map((e) => ({
          sequenceNumber: e.manifestEntry.sequenceNumber,
          fragmentId: e.manifestEntry.fragmentId,
          title: e.payload.title,
          source_rel_path: e.payload.source_rel_path,
          context_metadata: e.payload.context_metadata,
          structured_fields: e.payload.structured_fields,
          dagDependencies: e.manifestEntry.dagDependencies,
        })),
        null,
        2,
      ),
    );
    return 0;
  }

  if (command === 'inject') {
    if (!values.heap || !values['app-id'] || !values.purpose || !values.request) {
      console.error(
        'Error: --heap, --app-id, --purpose, and --request are required for `inject`',
      );
      return 1;
    }
    const requestedFields = String(values.request)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const approvedFields = values.allow
      ? String(values.allow)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const res = requestMinimalContextFromIfay(
      { heapDir: String(values.heap), heapSessionKey: sessionKey },
      {
        appId: String(values['app-id']),
        purpose: String(values.purpose),
        requestedFields,
      },
      {
        approvedFields,
        allowedPurposes: [String(values.purpose)],
      },
    );
    console.log(
      JSON.stringify(
        {
          approved: res.approved,
          rejectionReason: res.rejectionReason,
          agreementId: res.agreementId,
          injectedFields: res.injectedFields,
          withheldFields: res.withheldFields,
          strippedProtectedFields: res.strippedProtectedFields,
          wireFrameBytes: res.wireFrame?.byteLength ?? 0,
        },
        null,
        2,
      ),
    );
    return res.approved ? 0 : 2;
  }

  console.error(`Unknown command: ${command}`);
  console.error(USAGE);
  return 1;
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('/collector/cli.js') ||
    process.argv[1].endsWith('\\collector\\cli.js'));

if (isMain) {
  runDtpCollectorCli().then(
    (code) => {
      if (code !== 0) process.exitCode = code;
    },
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    },
  );
}
