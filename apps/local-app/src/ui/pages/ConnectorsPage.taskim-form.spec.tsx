import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectorsPage } from './ConnectorsPage';

jest.mock('../hooks/useProjectSelection', () => ({
  useSelectedProject: () => ({
    selectedProjectId: 'p1',
    selectedProject: { id: 'p1', name: 'P' },
  }),
}));

jest.mock('../hooks/use-toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

describe('ConnectorsPage Taskim form', () => {
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/api/connectors/taskim/preview-workspaces')) {
        return { ok: true, json: async () => [{ id: 'ws-1', name: 'Acme' }] } as Response;
      }
      if (url.includes('/api/connectors/taskim/preview-projects')) {
        return { ok: true, json: async () => [{ id: 'pr-1', name: 'Board A' }] } as Response;
      }
      if (url.startsWith('/api/connectors') && method === 'GET') {
        return { ok: true, json: async () => [] } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as jest.Mock;
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('renders API URL, API key, and Connect in the Taskim create form', async () => {
    render(
      <Wrapper>
        <ConnectorsPage />
      </Wrapper>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /add connector/i }));
    expect(await screen.findByPlaceholderText('http://localhost:3000')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Taskim API key')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /connect/i })).toBeInTheDocument();
  });

  it('calls preview-workspaces when Connect is clicked', async () => {
    render(
      <Wrapper>
        <ConnectorsPage />
      </Wrapper>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /add connector/i }));
    fireEvent.change(await screen.findByPlaceholderText('http://localhost:3000'), {
      target: { value: 'http://t.local' },
    });
    fireEvent.change(screen.getByPlaceholderText('Taskim API key'), {
      target: { value: 'k' },
    });
    fireEvent.click(screen.getByRole('button', { name: /connect/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/connectors/taskim/preview-workspaces',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('shows an error when Connect fails', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/connectors/taskim/preview-workspaces')) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ message: 'Bad API key' }),
        } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });
    render(
      <Wrapper>
        <ConnectorsPage />
      </Wrapper>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /add connector/i }));
    fireEvent.change(await screen.findByPlaceholderText('http://localhost:3000'), {
      target: { value: 'http://t.local' },
    });
    fireEvent.change(screen.getByPlaceholderText('Taskim API key'), {
      target: { value: 'bad' } as unknown as Event,
    });
    fireEvent.click(screen.getByRole('button', { name: /connect/i }));
    await waitFor(() => {
      expect(screen.getByText('Bad API key')).toBeInTheDocument();
    });
  });
});
