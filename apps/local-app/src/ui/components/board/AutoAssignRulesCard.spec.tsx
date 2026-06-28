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
