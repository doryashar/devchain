import { ConnectorsService } from './connectors.service';

function createMockStorage() {
  return {
    listConnectors: jest.fn().mockResolvedValue([
      { id: 'c1', projectId: 'p1', type: 'taskim', enabled: true, config: {}, name: 'T', externalProjectId: null, createdAt: '', updatedAt: '' },
      { id: 'c2', projectId: 'p1', type: 'monday', enabled: false, config: {}, name: 'M', externalProjectId: null, createdAt: '', updatedAt: '' },
    ]),
    getConnector: jest.fn(),
    createConnector: jest.fn(),
    updateConnector: jest.fn(),
    deleteConnector: jest.fn(),
    listStatusMappings: jest.fn().mockResolvedValue([]),
    createStatusMapping: jest.fn(),
    updateStatusMapping: jest.fn(),
    deleteStatusMapping: jest.fn(),
    getSyncState: jest.fn(),
    findSyncStateByExternalId: jest.fn(),
    createSyncState: jest.fn(),
    updateSyncState: jest.fn(),
    listSyncStates: jest.fn().mockResolvedValue([]),
    listFieldMappings: jest.fn(),
    createFieldMapping: jest.fn(),
    deleteFieldMapping: jest.fn(),
  };
}

describe('ConnectorsService', () => {
  it('should list enabled connectors', async () => {
    const storage = createMockStorage();
    const svc = new ConnectorsService(storage as any);
    const result = await svc.listEnabledForProject('p1');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('taskim');
  });

  it('should create a connector', async () => {
    const storage = createMockStorage();
    storage.createConnector = jest.fn().mockResolvedValue({ id: 'new-id', type: 'taskim' });
    const svc = new ConnectorsService(storage as any);
    const result = await svc.create({
      projectId: 'p1',
      type: 'taskim',
      name: 'Test',
      enabled: false,
      config: { apiUrl: 'http://localhost:3000', credentials: {} },
    } as any);
    expect(result.id).toBe('new-id');
  });

  it('should mark and check syncingFromRemote flag', () => {
    const svc = new ConnectorsService(createMockStorage() as any);
    svc.markSyncingFromRemote('epic-1');
    expect(svc.isSyncingFromRemote('epic-1')).toBe(true);
    expect(svc.isSyncingFromRemote('epic-1')).toBe(false);
  });
});
