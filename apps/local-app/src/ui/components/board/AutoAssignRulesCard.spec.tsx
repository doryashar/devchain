import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AutoAssignRulesCard } from './AutoAssignRulesCard';

const statuses = [
  { id: 'st-1', label: 'In Progress', color: '#3b82f6' },
  { id: 'st-2', label: 'Review', color: '#a855f7' },
];
const agents = [{ id: 'ag-1', name: 'Coder' }];
const teams = [{ id: 'team-1', name: 'Builders', teamLeadAgentName: 'Architect' }];

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

describe('AutoAssignRulesCard', () => {
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/api/auto-assign-rules') && method === 'GET') {
        return {
          ok: true,
          json: async () => [
            {
              id: 'r1',
              projectId: 'p',
              matchType: 'status',
              statusId: 'st-1',
              tags: null,
              targetType: 'team',
              targetAgentId: null,
              targetTeamId: 'team-1',
              overrideExisting: false,
              priority: 0,
              enabled: true,
              createdAt: '',
              updatedAt: '',
            },
          ],
        } as Response;
      }
      if (url.includes('/api/statuses'))
        return { ok: true, json: async () => ({ items: statuses }) } as Response;
      if (url.includes('/api/agents'))
        return { ok: true, json: async () => ({ items: agents }) } as Response;
      if (url.includes('/api/teams'))
        return { ok: true, json: async () => ({ items: teams }) } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    }) as jest.Mock;
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('renders the card title and one existing rule row', async () => {
    render(
      <Wrapper>
        <AutoAssignRulesCard projectId="p" />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText('Auto-assign rules')).toBeInTheDocument());
    expect(await screen.findByText(/Builders/)).toBeInTheDocument();
  });

  it('opens the add-rule form on Add rule click', async () => {
    render(
      <Wrapper>
        <AutoAssignRulesCard projectId="p" />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText('Add rule')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Add rule'));
    expect(await screen.findByText('Save rule')).toBeInTheDocument();
  });

  it('sends a PATCH when editing a rule and saving', async () => {
    const patchMock = jest.fn();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/api/auto-assign-rules') && method === 'PATCH') {
        patchMock(input, init);
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (url.includes('/api/auto-assign-rules') && method === 'GET') {
        return {
          ok: true,
          json: async () => [
            {
              id: 'r1',
              projectId: 'p',
              matchType: 'status',
              statusId: 'st-1',
              tags: null,
              targetType: 'agent',
              targetAgentId: 'ag-1',
              targetTeamId: null,
              overrideExisting: false,
              priority: 0,
              enabled: true,
              createdAt: '',
              updatedAt: '',
            },
          ],
        } as Response;
      }
      if (url.includes('/api/statuses'))
        return {
          ok: true,
          json: async () => ({ items: [{ id: 'st-1', label: 'Review', color: '#a855f7' }] }),
        } as Response;
      if (url.includes('/api/agents'))
        return {
          ok: true,
          json: async () => ({ items: [{ id: 'ag-1', name: 'Coder' }] }),
        } as Response;
      if (url.includes('/api/teams'))
        return { ok: true, json: async () => ({ items: [] }) } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    });
    render(
      <Wrapper>
        <AutoAssignRulesCard projectId="p" />
      </Wrapper>,
    );
    const editBtn = await screen.findByRole('button', { name: /edit rule/i });
    fireEvent.click(editBtn);
    fireEvent.click(screen.getByRole('switch', { name: /override existing/i }));
    fireEvent.click(screen.getByRole('button', { name: /save rule/i }));
    await waitFor(() => expect(patchMock).toHaveBeenCalled());
    const [url, init] = patchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/auto-assign-rules\/r1$/);
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      overrideExisting: true,
    });
  });

  it('sends a PUT reorder with sequential priorities after a drag', async () => {
    const putMock = jest.fn();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/api/auto-assign-rules/reorder') && method === 'PUT') {
        putMock(input, init);
        return { ok: true, json: async () => ({ success: true }) } as Response;
      }
      if (url.includes('/api/auto-assign-rules') && method === 'GET') {
        return {
          ok: true,
          json: async () => [
            {
              id: 'r1',
              projectId: 'p',
              matchType: 'status',
              statusId: 'st-1',
              tags: null,
              targetType: 'agent',
              targetAgentId: 'ag-1',
              targetTeamId: null,
              overrideExisting: false,
              priority: 0,
              enabled: true,
              createdAt: '',
              updatedAt: '',
            },
            {
              id: 'r2',
              projectId: 'p',
              matchType: 'status',
              statusId: 'st-1',
              tags: null,
              targetType: 'agent',
              targetAgentId: 'ag-1',
              targetTeamId: null,
              overrideExisting: false,
              priority: 1,
              enabled: true,
              createdAt: '',
              updatedAt: '',
            },
          ],
        } as Response;
      }
      if (url.includes('/api/statuses'))
        return {
          ok: true,
          json: async () => ({ items: [{ id: 'st-1', label: 'Review', color: '#a855f7' }] }),
        } as Response;
      if (url.includes('/api/agents'))
        return {
          ok: true,
          json: async () => ({ items: [{ id: 'ag-1', name: 'Coder' }] }),
        } as Response;
      if (url.includes('/api/teams'))
        return { ok: true, json: async () => ({ items: [] }) } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    });
    render(
      <Wrapper>
        <AutoAssignRulesCard projectId="p" />
      </Wrapper>,
    );
    const rows = await screen.findAllByTestId('auto-assign-rule-row');
    expect(rows).toHaveLength(2);
    fireEvent.dragStart(rows[1]);
    fireEvent.dragOver(rows[0]);
    fireEvent.dragEnd(rows[1]);
    await waitFor(() => expect(putMock).toHaveBeenCalled());
    const [, init] = putMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      items: [
        { id: 'r2', priority: 0 },
        { id: 'r1', priority: 1 },
      ],
    });
  });

  it('shows an "invalid" badge for a stale status rule', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/auto-assign-rules')) {
        return {
          ok: true,
          json: async () => [
            {
              id: 'r1',
              projectId: 'p',
              matchType: 'status',
              statusId: 'gone',
              tags: null,
              targetType: 'agent',
              targetAgentId: 'ag-1',
              targetTeamId: null,
              overrideExisting: false,
              priority: 0,
              enabled: true,
              createdAt: '',
              updatedAt: '',
            },
          ],
        } as Response;
      }
      if (url.includes('/api/statuses'))
        return { ok: true, json: async () => ({ items: statuses }) } as Response;
      if (url.includes('/api/agents'))
        return { ok: true, json: async () => ({ items: agents }) } as Response;
      if (url.includes('/api/teams'))
        return { ok: true, json: async () => ({ items: teams }) } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    });
    render(
      <Wrapper>
        <AutoAssignRulesCard projectId="p" />
      </Wrapper>,
    );
    expect(await screen.findByText(/invalid/i)).toBeInTheDocument();
  });
});
