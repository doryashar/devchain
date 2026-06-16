import { TaskimAdapter } from './taskim.adapter';

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

function mockResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('TaskimAdapter', () => {
  let adapter: TaskimAdapter;

  beforeEach(() => {
    adapter = new TaskimAdapter();
    mockFetch.mockReset();
  });

  const config = {
    apiUrl: 'http://localhost:3000',
    credentials: { email: 'test@example.com', password: 'pass' },
    workspaceId: 'ws-1',
    externalProjectId: 'proj-1',
  };

  it('should authenticate and cache token', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse({ accessToken: 'jwt-token' }))
      .mockResolvedValueOnce(mockResponse([]));

    const result = await adapter.testConnection(config);
    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should test connection and return failure on bad auth', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Unauthorized' }, false, 401));
    const result = await adapter.testConnection(config);
    expect(result.success).toBe(false);
  });

  it('should resolve webhook payload for task.updated', async () => {
    const payload = {
      type: 'task.updated',
      task: { id: 'ext-1', title: 'Updated Task', status: 'in_progress' },
      timestamp: '2026-06-16T12:00:00Z',
    };
    const result = await adapter.resolveWebhook(payload, config);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('updated');
    expect(result!.externalId).toBe('ext-1');
    expect(result!.fields!.title).toBe('Updated Task');
  });

  it('should return null for unresolvable webhook payload', async () => {
    const result = await adapter.resolveWebhook(null, config);
    expect(result).toBeNull();
  });

  it('should push a new epic (create task)', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse({ accessToken: 'jwt' }))
      .mockResolvedValueOnce(mockResponse({ id: 'task-999' }));

    const result = await adapter.pushEpic(
      {
        epic: { id: 'epic-1', title: 'Test', description: 'desc' } as any,
        statusMappings: [
          { devchainStatusLabel: 'New', externalStatusId: 'todo' } as any,
        ],
        syncState: { externalId: null, lastSyncedAt: null },
      },
      config,
    );

    expect(result.success).toBe(true);
    expect(result.externalId).toBe('task-999');
  });
});
