import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDecipheriv } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  IFAY_DTP_CONTEXT_SCHEMA,
  IFAY_DTP_INJECTION_SCHEMA,
  PersonalDataHeap,
  collectWorkspaceToHeap,
  deriveCollectorKeyFromHexOrPassphrase,
  requestMinimalContextFromIfay,
  runDtpCollectorCli,
  runDtpCollectorDemo,
  watchWorkspaceToHeap,
} from './index.js';
import { DTPFrameCodec } from '../components/frame-codec.js';
import { DTPEncryptionModule } from '../components/encryption-module.js';

describe('DTP 1.0 Personal Context Collector & Minimal Injection SDK (dtp-collector)', () => {
  let tempRoot: string;
  let workspaceDir: string;
  let heapDir: string;
  let sessionKey: Uint8Array;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'dtp-collector-test-'));
    workspaceDir = join(tempRoot, 'workspace');
    heapDir = join(tempRoot, 'heap');
    mkdirSync(workspaceDir, { recursive: true });
    sessionKey = deriveCollectorKeyFromHexOrPassphrase('unit-test-ifay-heap-secret-01');
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('Flow 1: collects workspace notes with contextual metadata into encrypted DTP 1.0 wire frames compatible with @ifay/soul', () => {
    writeFileSync(
      join(workspaceDir, 'prefs.md'),
      [
        '---',
        'dietary_preference: vegan_gluten_free',
        'schedule_window: "18:30-20:00"',
        '---',
        '# Personal Dining & Focus Note',
        'Secret journal line: met Bob at JingAn Kerry Centre.',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      join(workspaceDir, 'reading.json'),
      JSON.stringify({ preferred_topic: 'distributed-systems', max_budget_cny: 180 }),
      'utf8',
    );

    const res = collectWorkspaceToHeap({
      workspaceDir,
      heapDir,
      sessionKey,
      ownerFayId: 'ifay_alicecollector2345678',
      ambientContext: {
        timestamp: '2026-11-20T12:00:00.000Z',
        timezone: 'Asia/Shanghai',
        ambient_activity: 'reading',
        device_class: 'laptop_workstation',
        source_app: 'obsidian',
      },
    });

    expect(res.scannedFiles).toBe(2);
    expect(res.committedFrames).toBe(2);
    expect(res.wireFrames).toHaveLength(2);
    expect(res.heapManifest.frame_count).toBe(2);

    // Verify zero plaintext leakage on disk
    const rawFrameBytes = readFileSync(join(heapDir, res.heapManifest.frames[0].frameFile));
    const rawAscii = rawFrameBytes.toString('utf8');
    expect(rawAscii).not.toContain('vegan_gluten_free');
    expect(rawAscii).not.toContain('Secret journal line');

    // Verify independent wire format compatibility with @ifay/sdk / @ifay/soul decodeDtpFrame contract
    const wire = Buffer.from(res.wireFrames[0]);
    const headerLen = wire.readUInt32BE(0);
    const parsedHeader = JSON.parse(wire.subarray(4, 4 + headerLen).toString('utf8'));
    expect(parsedHeader.protocolVersion).toEqual({ major: 1, minor: 0 });
    expect(parsedHeader.encryptionMetadata.algorithm).toBe('AES-256-GCM');
    const encPayload = wire.subarray(4 + headerLen);
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(sessionKey),
      encPayload.subarray(0, 12),
    );
    decipher.setAuthTag(encPayload.subarray(encPayload.length - 16));
    const plaintextJson = JSON.parse(
      Buffer.concat([
        decipher.update(encPayload.subarray(12, encPayload.length - 16)),
        decipher.final(),
      ]).toString('utf8'),
    );
    expect(plaintextJson.schema).toBe(IFAY_DTP_CONTEXT_SCHEMA);
    expect(plaintextJson.title).toBe('Personal Dining & Focus Note');
    expect(plaintextJson.context_metadata).toEqual({
      timestamp: '2026-11-20T12:00:00.000Z',
      timezone: 'Asia/Shanghai',
      ambient_activity: 'reading',
      device_class: 'laptop_workstation',
      source_app: 'obsidian',
    });

    // Wrong key fails decryption
    const wrongKey = deriveCollectorKeyFromHexOrPassphrase('wrong-secret');
    const heap = new PersonalDataHeap(heapDir);
    expect(() => heap.readDecryptedEntries(wrongKey)).toThrow();
  });

  it('Flow 1 incremental deduplication & causal DAG edges when a note is edited', () => {
    const notePath = join(workspaceDir, 'roadmap.md');
    writeFileSync(notePath, '# Roadmap v1\n- milestone: alpha\n', 'utf8');

    const first = collectWorkspaceToHeap({ workspaceDir, heapDir, sessionKey });
    expect(first.committedFrames).toBe(1);

    // Re-running without edits commits 0 duplicate frames
    const unchanged = collectWorkspaceToHeap({ workspaceDir, heapDir, sessionKey });
    expect(unchanged.committedFrames).toBe(0);

    // Editing the note creates a new fragment with a `derived_from` DAG dependency on v1
    writeFileSync(notePath, '# Roadmap v2\n- milestone: beta\n', 'utf8');
    const updated = collectWorkspaceToHeap({ workspaceDir, heapDir, sessionKey });
    expect(updated.committedFrames).toBe(1);
    expect(updated.heapManifest.frame_count).toBe(2);
    expect(updated.heapManifest.frames[1].dagDependencies).toEqual([
      {
        targetFragmentId: first.heapManifest.frames[0].fragmentId,
        relationType: 'derived_from',
      },
    ]);
  });

  it('watchWorkspaceToHeap commits changes detected in watched directory', async () => {
    writeFileSync(join(workspaceDir, 'live.md'), '# Live Note\n- mood: focused\n', 'utf8');
    let commitNotifications = 0;
    const handle = watchWorkspaceToHeap({
      workspaceDir,
      heapDir,
      sessionKey,
      debounceMs: 30,
      onCommit: () => {
        commitNotifications += 1;
      },
    });

    try {
      expect(commitNotifications).toBe(1);
      writeFileSync(join(workspaceDir, 'live.md'), '# Live Note\n- mood: energized\n', 'utf8');
      const flushed = handle.flush();
      expect(flushed.heapManifest.frame_count).toBe(2);
    } finally {
      handle.close();
    }
  });

  it('Flow 2: requestMinimalContextFromIfay strips raw history, identifiers, and unapproved fields while encrypting minimal approved fields', () => {
    writeFileSync(
      join(workspaceDir, 'profile-notes.md'),
      [
        '---',
        'dietary_preference: halal_no_shellfish',
        'schedule_window: "12:30-13:30"',
        'salary_expectation: 950000',
        'email: private@example.com',
        'human_prime_id: human_privateid234567890',
        '---',
        '# Confidential Career & Lunch Notes',
        'Full raw private diary text that must never leave iFay.',
      ].join('\n'),
      'utf8',
    );

    collectWorkspaceToHeap({ workspaceDir, heapDir, sessionKey });
    const appSessionKey = deriveCollectorKeyFromHexOrPassphrase('external-restaurant-app-key');

    const result = requestMinimalContextFromIfay(
      { heapDir, heapSessionKey: sessionKey },
      {
        appId: 'smart-lunch-concierge',
        purpose: 'lunch_booking',
        requestedFields: [
          'dietary_preference',
          'schedule_window',
          'salary_expectation',
          'email',
          'human_prime_id',
          'text',
          'source_rel_path',
        ],
        appSessionKey,
      },
      {
        // Even if someone mistakenly listed 'email' or 'text' in approvedFields, ALWAYS_STRIPPED_KEYS blocks them!
        approvedFields: ['dietary_preference', 'schedule_window', 'email', 'text'],
        allowedPurposes: ['lunch_booking'],
      },
    );

    expect(result.approved).toBe(true);
    expect(result.injectedFields).toEqual({
      dietary_preference: 'halal_no_shellfish',
      schedule_window: '12:30-13:30',
    });
    expect(result.strippedProtectedFields).toEqual([
      'email',
      'human_prime_id',
      'text',
      'source_rel_path',
    ]);
    expect(result.withheldFields).toContain('salary_expectation');
    expect(result.wireFrame).toBeInstanceOf(Uint8Array);

    // Verify wireFrame is encrypted with appSessionKey (NOT heap sessionKey!)
    const codec = new DTPFrameCodec();
    const deserialized = codec.deserialize(result.wireFrame!);
    const heapDecryptor = new DTPEncryptionModule(sessionKey);
    expect(() =>
      heapDecryptor.decryptPayload(
        deserialized.payload,
        deserialized.header.encryptionMetadata,
      ),
    ).toThrow();

    const appDecryptor = new DTPEncryptionModule(appSessionKey);
    const appPlaintext = JSON.parse(
      Buffer.from(
        appDecryptor.decryptPayload(
          deserialized.payload,
          deserialized.header.encryptionMetadata,
        ),
      ).toString('utf8'),
    );
    expect(appPlaintext.schema).toBe(IFAY_DTP_INJECTION_SCHEMA);
    expect(appPlaintext.attributes).toEqual({
      dietary_preference: 'halal_no_shellfish',
      schedule_window: '12:30-13:30',
    });
    expect(JSON.stringify(appPlaintext)).not.toContain('diary text');
    expect(JSON.stringify(appPlaintext)).not.toContain('950000');
    expect(JSON.stringify(appPlaintext)).not.toContain('private@example.com');
  });

  it('Flow 2: rejects unauthorized purpose or zero-approved-field requests with compliance reason', () => {
    writeFileSync(join(workspaceDir, 'n.md'), '---\ndietary_preference: keto\n---\n# Note\n', 'utf8');
    collectWorkspaceToHeap({ workspaceDir, heapDir, sessionKey });

    const deniedPurpose = requestMinimalContextFromIfay(
      { heapDir, heapSessionKey: sessionKey },
      {
        appId: 'ad-tracker',
        purpose: 'ad_profiling',
        requestedFields: ['dietary_preference'],
      },
      {
        approvedFields: ['dietary_preference'],
        allowedPurposes: ['dining_personalization'],
      },
    );
    expect(deniedPurpose.approved).toBe(false);
    expect(deniedPurpose.rejectionReason).toContain('ad_profiling');
    expect(deniedPurpose.wireFrame).toBeNull();

    const deniedFields = requestMinimalContextFromIfay(
      { heapDir, heapSessionKey: sessionKey },
      {
        appId: 'nosy-app',
        purpose: 'dining_personalization',
        requestedFields: ['text', 'human_prime_id'],
      },
      {
        approvedFields: ['dietary_preference'],
        allowedPurposes: ['dining_personalization'],
      },
    );
    expect(deniedFields.approved).toBe(false);
    expect(deniedFields.wireFrame).toBeNull();
  });

  it('CLI & Demo: runs demo, collect, inspect, and inject commands cleanly', async () => {
    const demoReport = runDtpCollectorDemo({ silent: true });
    expect(demoReport.collection.committedFrames).toBe(2);
    expect(demoReport.collection.zeroPlaintextOnDisk).toBe(true);
    expect(demoReport.minimalInjection.approved).toBe(true);
    expect(demoReport.minimalInjection.injectedFields).toEqual({
      dietary_preference: 'vegetarian_no_peanuts',
      schedule_window: '19:00-20:30',
    });

    writeFileSync(join(workspaceDir, 'cli.md'), '---\ntheme_preference: dark\n---\n# CLI\n', 'utf8');
    const codeCollect = await runDtpCollectorCli([
      'collect',
      '--workspace',
      workspaceDir,
      '--heap',
      heapDir,
      '--key',
      'cli-secret',
    ]);
    expect(codeCollect).toBe(0);

    const codeInspect = await runDtpCollectorCli([
      'inspect',
      '--heap',
      heapDir,
      '--key',
      'cli-secret',
    ]);
    expect(codeInspect).toBe(0);

    const codeInject = await runDtpCollectorCli([
      'inject',
      '--heap',
      heapDir,
      '--key',
      'cli-secret',
      '--app-id',
      'ide-shell',
      '--purpose',
      'ui_theme',
      '--request',
      'theme_preference,text',
      '--allow',
      'theme_preference',
    ]);
    expect(codeInject).toBe(0);
  });
});
