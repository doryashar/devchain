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

function mockFetchSequence(responses: Array<{ ok?: boolean; status?: number; body: unknown }>) {
  const queue = [...responses];
  global.fetch = jest.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('No more mock responses queued');
    const ok = next.ok ?? true;
    const status = next.status ?? (ok ? 200 : 400);
    return { ok, status, json: async () => next.body } as unknown as Response;
  }) as unknown as typeof fetch;
}

const tokenConfig = {
  apiUrl: 'http://taskim.local',
  credentials: { token: 'tok-123' },
};

describe('TaskimAdapter', () => {
  let adapter: TaskimAdapter;

  beforeEach(() => {
    adapter = new TaskimAdapter();
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  const config = {
    apiUrl: 'http://localhost:3000',
    credentials: { token: 'tok-123' },
    workspaceId: 'ws-1',
    externalProjectId: 'proj-1',
  };

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
    mockFetch.mockResolvedValueOnce(mockResponse({ id: 'task-999' }));

    const result = await adapter.pushEpic(
      {
        epic: { id: 'epic-1', title: 'Test', description: 'desc' } as any,
        statusMappings: [{ devchainStatusLabel: 'New', externalStatusId: 'todo' } as any],
        syncState: { externalId: null, lastSyncedAt: null },
      },
      config,
    );

    expect(result.success).toBe(true);
    expect(result.externalId).toBe('task-999');
  });
});

describe('TaskimAdapter listWorkspaces/listProjects/createWorkspace/createProject', () => {
  it('listWorkspaces GETs /api/v1/workspaces and returns {id,name}[] (array shape)', async () => {
    const adapter = new TaskimAdapter();
    mockFetchSequence([
      {
        body: [
          { id: 'ws-1', name: 'Acme' },
          { id: 'ws-2', name: 'Omega' },
        ],
      },
    ]);
    const result = await adapter.listWorkspaces(tokenConfig);
    expect(result).toEqual([
      { id: 'ws-1', name: 'Acme' },
      { id: 'ws-2', name: 'Omega' },
    ]);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      'http://taskim.local/api/v1/workspaces',
    );
  });

  it('listWorkspaces handles { data: [...] } shape', async () => {
    const adapter = new TaskimAdapter();
    mockFetchSequence([{ body: { data: [{ id: 'ws-1', name: 'Acme' }] } }]);
    const result = await adapter.listWorkspaces(tokenConfig);
    expect(result).toEqual([{ id: 'ws-1', name: 'Acme' }]);
  });

  it('listProjects requires workspaceId and GETs /api/v1/workspaces/:wid/projects', async () => {
    const adapter = new TaskimAdapter();
    mockFetchSequence([{ body: [{ id: 'p-1', name: 'Board A' }] }]);
    const result = await adapter.listProjects({ ...tokenConfig, workspaceId: 'ws-1' });
    expect(result).toEqual([{ id: 'p-1', name: 'Board A' }]);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      'http://taskim.local/api/v1/workspaces/ws-1/projects',
    );
  });

  it('listProjects returns [] when no workspaceId', async () => {
    const adapter = new TaskimAdapter();
    const result = await adapter.listProjects(tokenConfig);
    expect(result).toEqual([]);
  });

  it('createWorkspace POSTs {name} and returns {id,name}', async () => {
    const adapter = new TaskimAdapter();
    mockFetchSequence([{ body: { id: 'ws-new', name: 'Fresh' } }]);
    const result = await adapter.createWorkspace(tokenConfig, 'Fresh');
    expect(result).toEqual({ id: 'ws-new', name: 'Fresh' });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://taskim.local/api/v1/workspaces');
    expect((init as any).method).toBe('POST');
    expect(JSON.parse((init as any).body)).toEqual({ name: 'Fresh' });
  });

  it('createWorkspace throws on non-2xx', async () => {
    const adapter = new TaskimAdapter();
    mockFetchSequence([{ ok: false, status: 403, body: { message: 'forbidden' } }]);
    await expect(adapter.createWorkspace(tokenConfig, 'X')).rejects.toThrow();
  });

  it('createProject POSTs {name} under the workspace', async () => {
    const adapter = new TaskimAdapter();
    mockFetchSequence([{ body: { id: 'p-new', name: 'Board N' } }]);
    const result = await adapter.createProject({ ...tokenConfig, workspaceId: 'ws-1' }, 'Board N');
    expect(result).toEqual({ id: 'p-new', name: 'Board N' });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://taskim.local/api/v1/workspaces/ws-1/projects');
    expect((init as any).method).toBe('POST');
    expect(JSON.parse((init as any).body)).toEqual({ name: 'Board N' });
  });

  it('createProject throws when workspaceId is missing', async () => {
    const adapter = new TaskimAdapter();
    await expect(adapter.createProject(tokenConfig, 'Board N')).rejects.toThrow();
  });
});

describe('TaskimAdapter authenticate (token-only)', () => {
  it('uses credentials.token directly as Bearer without any login POST', async () => {
    const adapter = new TaskimAdapter();
    let postedLogin = false;
    global.fetch = jest.fn(async (url: RequestInfo | URL) => {
      const s = String(url);
      if (s.endsWith('/api/v1/auth/login')) postedLogin = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'ws-1', name: 'x' }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    await adapter.listWorkspaces(tokenConfig);
    expect(postedLogin).toBe(false);
    const authHeader = (global.fetch as jest.Mock).mock.calls[0][1]?.headers?.Authorization;
    expect(authHeader).toBe('Bearer tok-123');
  });
});
