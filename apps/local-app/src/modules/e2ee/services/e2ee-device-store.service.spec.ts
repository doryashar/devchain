import { Test, TestingModule } from '@nestjs/testing';
import { DB_CONNECTION } from '../../storage/db/db.provider';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { E2eeDeviceStoreService, type E2eePeerDevice } from './e2ee-device-store.service';

// Test layer: module-unit with REAL :memory: SQLite. The directory is JSON-serialized
// to the settings table; a real DB proves the add/get/revoke persistence + reset paths.
describe('E2eeDeviceStoreService', () => {
  let service: E2eeDeviceStoreService;
  let sqlite: Database.Database;

  beforeEach(async () => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    const db = drizzle(sqlite);

    const module: TestingModule = await Test.createTestingModule({
      providers: [E2eeDeviceStoreService, { provide: DB_CONNECTION, useValue: db }],
    }).compile();

    service = module.get<E2eeDeviceStoreService>(E2eeDeviceStoreService);
  });

  afterEach(() => {
    sqlite.close();
  });

  const sample = (kid = 'a'.repeat(32)): Omit<E2eePeerDevice, 'addedAt' | 'trust'> => ({
    kid,
    publicKeyB64: Buffer.from(new Uint8Array(32).fill(1)).toString('base64'),
    label: 'Pixel 8',
  });

  it('returns an empty list when nothing is stored', () => {
    expect(service.list()).toEqual([]);
    expect(service.get('unknown')).toBeNull();
  });

  it('adds a peer device and retrieves it by kid', () => {
    const rec = service.add(sample());
    expect(rec.kid).toBe('a'.repeat(32));
    expect(rec.addedAt).toBeDefined();
    expect(rec.label).toBe('Pixel 8');

    const got = service.get('a'.repeat(32));
    expect(got).toEqual(rec);
  });

  it('persists across a new service instance (restart)', () => {
    service.add(sample('b'.repeat(32)));
    const restarted = new E2eeDeviceStoreService(drizzle(sqlite));
    expect(restarted.get('b'.repeat(32))?.publicKeyB64).toBeDefined();
    expect(restarted.list()).toHaveLength(1);
  });

  it('updates (overwrites) a device on re-add with the same kid', () => {
    service.add(sample('c'.repeat(32)));
    const updated = service.add({
      kid: 'c'.repeat(32),
      publicKeyB64: Buffer.from(new Uint8Array(32).fill(9)).toString('base64'),
    });
    expect(updated.label).toBeUndefined();
    expect(service.list()).toHaveLength(1);
    expect(service.get('c'.repeat(32))?.publicKeyB64).toBe(
      Buffer.from(new Uint8Array(32).fill(9)).toString('base64'),
    );
  });

  it('revokes a device by kid and returns true; false when unknown', () => {
    service.add(sample('d'.repeat(32)));
    expect(service.revoke('d'.repeat(32))).toBe(true);
    expect(service.get('d'.repeat(32))).toBeNull();
    expect(service.revoke('never')).toBe(false);
  });

  it('does not share a namespace with the keypair record', () => {
    service.add(sample());
    const keypairRow = sqlite
      .prepare("SELECT value FROM settings WHERE key = 'cloud.e2ee.keypair'")
      .get() as { value: string } | undefined;
    expect(keypairRow).toBeUndefined();
    const devicesRow = sqlite
      .prepare("SELECT value FROM settings WHERE key = 'cloud.e2ee.devices'")
      .get() as { value: string } | undefined;
    expect(devicesRow).toBeDefined();
  });

  it('resets gracefully if the stored directory is corrupt JSON', () => {
    service.add(sample());
    sqlite
      .prepare("UPDATE settings SET value = ? WHERE key = 'cloud.e2ee.devices'")
      .run('not-json');
    expect(service.list()).toEqual([]);
    // and is usable afterwards
    service.add(sample('e'.repeat(32)));
    expect(service.list()).toHaveLength(1);
  });

  describe('idempotent re-pair (Task:7)', () => {
    it('overwrites the prior key in place on re-pair (same kid, fresh key) — no duplicate', () => {
      const kid = 'p'.repeat(32);
      service.add({
        kid,
        publicKeyB64: Buffer.from(new Uint8Array(32).fill(1)).toString('base64'),
        trust: 'verified',
        verifiedVia: 'qr',
        verifiedAt: '2026-06-01T00:00:00.000Z',
      });
      // Re-pair after a mobile logout/re-login: a fresh keypair under the same device kid.
      const repaired = service.add({
        kid,
        publicKeyB64: Buffer.from(new Uint8Array(32).fill(2)).toString('base64'),
        trust: 'verified',
        verifiedVia: 'qr',
        verifiedAt: '2026-06-22T00:00:00.000Z',
      });

      expect(service.list()).toHaveLength(1); // retired the old, no duplicate
      expect(repaired.publicKeyB64).toBe(
        Buffer.from(new Uint8Array(32).fill(2)).toString('base64'),
      );
      const restarted = new E2eeDeviceStoreService(drizzle(sqlite));
      expect(restarted.get(kid)?.verifiedAt).toBe('2026-06-22T00:00:00.000Z');
    });

    it('reconcile re-pair with the same key is a no-op overwrite (idempotent)', () => {
      const pub = Buffer.from(new Uint8Array(32).fill(3)).toString('base64');
      const first = service.reconcile({ kid: 'q'.repeat(32), publicKeyB64: pub });
      const second = service.reconcile({ kid: 'q'.repeat(32), publicKeyB64: pub });
      expect(service.list()).toHaveLength(1);
      expect(second.addedAt).toBe(first.addedAt); // unchanged record preserved
    });
  });

  describe('trust state (Task:4)', () => {
    it('defaults trust to unverified when not specified', () => {
      const rec = service.add(sample('f'.repeat(32)));
      expect(rec.trust).toBe('unverified');
      expect(rec.verifiedVia).toBeUndefined();
      expect(rec.verifiedAt).toBeUndefined();
    });

    it('persists a verified record with method + verifiedAt', () => {
      const rec = service.add({
        kid: 'g'.repeat(32),
        publicKeyB64: Buffer.from(new Uint8Array(32).fill(7)).toString('base64'),
        trust: 'verified',
        verifiedVia: 'qr',
        verifiedAt: '2026-06-22T00:00:00.000Z',
      });
      expect(rec.trust).toBe('verified');
      expect(rec.verifiedVia).toBe('qr');
      const restarted = new E2eeDeviceStoreService(drizzle(sqlite));
      expect(restarted.get('g'.repeat(32))?.trust).toBe('verified');
      expect(restarted.get('g'.repeat(32))?.verifiedVia).toBe('qr');
    });

    it('reconciles a brand-new key as unverified email-tofu (TOFU adopt)', () => {
      const rec = service.reconcile({
        kid: 'r'.repeat(32),
        publicKeyB64: Buffer.from(new Uint8Array(32).fill(3)).toString('base64'),
      });
      expect(rec.trust).toBe('unverified');
      expect(rec.adoptedVia).toBe('email-tofu');
      expect(service.get('r'.repeat(32))?.trust).toBe('unverified');
    });

    it('preserves a verified record when reconciling an unchanged key', () => {
      const pub = Buffer.from(new Uint8Array(32).fill(4)).toString('base64');
      service.add({ kid: 's'.repeat(32), publicKeyB64: pub, trust: 'verified', verifiedVia: 'qr' });
      const rec = service.reconcile({ kid: 's'.repeat(32), publicKeyB64: pub });
      expect(rec.trust).toBe('verified');
      expect(rec.verifiedVia).toBe('qr');
    });

    it('reverts to unverified when an existing device key changes (rotation)', () => {
      const kid = 't'.repeat(32);
      service.add({
        kid,
        publicKeyB64: Buffer.from(new Uint8Array(32).fill(5)).toString('base64'),
        trust: 'verified',
        verifiedVia: 'safety-number',
        verifiedAt: '2026-02-01T00:00:00.000Z',
      });
      const rotated = service.reconcile({
        kid,
        publicKeyB64: Buffer.from(new Uint8Array(32).fill(6)).toString('base64'),
      });
      expect(rotated.trust).toBe('unverified');
      expect(rotated.verifiedVia).toBeUndefined();
      expect(rotated.verifiedAt).toBeUndefined();
    });

    it('markVerified upgrades a TOFU record to verified via safety-number', () => {
      service.reconcile({
        kid: 'u'.repeat(32),
        publicKeyB64: Buffer.from(new Uint8Array(32).fill(8)).toString('base64'),
      });
      const verified = service.markVerified('u'.repeat(32), '2026-06-23T00:00:00.000Z');
      expect(verified?.trust).toBe('verified');
      expect(verified?.verifiedVia).toBe('safety-number');
      expect(verified?.verifiedAt).toBe('2026-06-23T00:00:00.000Z');
      // persisted
      expect(new E2eeDeviceStoreService(drizzle(sqlite)).get('u'.repeat(32))?.trust).toBe(
        'verified',
      );
    });

    it('markVerified returns null for an unknown device', () => {
      expect(service.markVerified('missing')).toBeNull();
    });

    it('normalizes a legacy record (no trust field) to unverified, never verified', () => {
      // Simulate a Task:3-era record persisted before the trust field existed.
      const legacy = {
        v: 1,
        devices: {
          ['h'.repeat(32)]: {
            kid: 'h'.repeat(32),
            publicKeyB64: Buffer.from(new Uint8Array(32).fill(2)).toString('base64'),
            addedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      };
      const now = new Date().toISOString();
      sqlite
        .prepare(
          `INSERT INTO settings (id, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .run('row-1', 'cloud.e2ee.devices', JSON.stringify(legacy), now, now);

      expect(service.get('h'.repeat(32))?.trust).toBe('unverified');
    });
  });
});
