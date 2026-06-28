import { Test, TestingModule } from '@nestjs/testing';
import { DB_CONNECTION } from '../../storage/db/db.provider';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { x25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha2';
import { E2eeKeypairService } from './e2ee-keypair.service';

// Test layer: module-unit with REAL :memory: SQLite (not a mock). The encryption path
// is the security-critical surface; a mock DB would not prove the at-rest blob is
// actually opaque or that persist/retrieve round-trips through real SQL.
describe('E2eeKeypairService', () => {
  let service: E2eeKeypairService;
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
      providers: [E2eeKeypairService, { provide: DB_CONNECTION, useValue: db }],
    }).compile();

    service = module.get<E2eeKeypairService>(E2eeKeypairService);
  });

  afterEach(() => {
    sqlite.close();
  });

  const readStoredBlob = (): string | undefined =>
    (
      sqlite.prepare("SELECT value FROM settings WHERE key = 'cloud.e2ee.keypair'").get() as
        | { value: string }
        | undefined
    )?.value;

  it('generates a valid 32-byte X25519 keypair with a deterministic kid on first call', async () => {
    const kp = await service.getOrCreate();
    expect(kp.privateKey.length).toBe(32);
    expect(kp.publicKey.length).toBe(32);
    expect(kp.kid).toMatch(/^[0-9a-f]{32}$/);

    // kid == first 16 bytes of sha256(publicKey), hex
    const expected = Array.from(sha256(kp.publicKey).subarray(0, 16))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(kp.kid).toBe(expected);

    // publicKey is the X25519 scalar-mult of the (clamped) private key
    expect(Array.from(kp.publicKey)).toEqual(Array.from(x25519.getPublicKey(kp.privateKey)));
  });

  it('persists the private key encrypted-at-rest under cloud.e2ee.keypair (NOT the tunnel keypair)', async () => {
    const kp = await service.getOrCreate();
    const blob = readStoredBlob();
    expect(blob).toBeDefined();

    // The at-rest blob is opaque base64 — the private key bytes never appear in it.
    const privB64 = Buffer.from(kp.privateKey).toString('base64');
    expect(blob!).not.toContain(privB64);
    expect(blob!).not.toContain(kp.kid);

    // Distinct namespace from the tunnel keypair record.
    const tunnelRow = sqlite
      .prepare("SELECT value FROM settings WHERE key = 'cloud.tunnel.keypair'")
      .get() as { value: string } | undefined;
    expect(tunnelRow).toBeUndefined();
  });

  it('returns the SAME keypair on subsequent getOrCreate (in-memory cache)', async () => {
    const first = await service.getOrCreate();
    const second = await service.getOrCreate();
    expect(Array.from(first.privateKey)).toEqual(Array.from(second.privateKey));
    expect(first.kid).toBe(second.kid);
  });

  it('survives a restart: a new service instance reloads the persisted keypair', async () => {
    const first = await service.getOrCreate();
    expect(readStoredBlob()).toBeDefined();

    const db2 = drizzle(sqlite);
    const restarted = new E2eeKeypairService(db2);
    const reloaded = await restarted.getOrCreate();

    expect(Array.from(reloaded.privateKey)).toEqual(Array.from(first.privateKey));
    expect(Array.from(reloaded.publicKey)).toEqual(Array.from(first.publicKey));
    expect(reloaded.kid).toBe(first.kid);
  });

  it('produces different blobs / keypairs across independent instances (random keygen)', async () => {
    await service.getOrCreate();
    const blob1 = readStoredBlob();

    sqlite.exec("DELETE FROM settings WHERE key = 'cloud.e2ee.keypair'");
    const db2 = drizzle(sqlite);
    const other = new E2eeKeypairService(db2);
    await other.getOrCreate();
    const blob2 = readStoredBlob();

    expect(blob1).not.toBe(blob2);
  });

  it('exportPublic returns the kid + base64 public key but NEVER the private key', async () => {
    const kp = await service.getOrCreate();
    const exported = await service.exportPublic();
    expect(exported.kid).toBe(kp.kid);
    expect(exported.publicKeyB64).toBe(Buffer.from(kp.publicKey).toString('base64'));
    expect(JSON.stringify(exported)).not.toContain(Buffer.from(kp.privateKey).toString('base64'));
  });

  it('regenerates if the at-rest record is corrupted (decrypt fails closed, no crash)', async () => {
    await service.getOrCreate();
    // Corrupt the stored blob so AES-GCM auth fails.
    sqlite
      .prepare("UPDATE settings SET value = ? WHERE key = 'cloud.e2ee.keypair'")
      .run('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

    const db2 = drizzle(sqlite);
    const restarted = new E2eeKeypairService(db2);
    const regenerated = await restarted.getOrCreate();
    expect(regenerated.kid).toMatch(/^[0-9a-f]{32}$/);
    // A fresh encrypted blob was written.
    const blob = readStoredBlob();
    expect(blob).toBeDefined();
    expect(blob).not.toBe('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  });
});
