import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useDevicesQuery } from './useDevicesQuery';

const mockUseCloudConnection = jest.fn();
jest.mock('./useCloudConnection', () => ({
  useCloudConnection: () => mockUseCloudConnection(),
}));

const mockFetch = jest.fn();

function makeWrapper() {
  // Real QueryClient so the cache (and staleTime) behaves like production — this is what
  // makes the account-switch regression observable.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return wrapper;
}

function devicesResponse(devices: Array<{ id: string }>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      devices: devices.map((d) => ({ ...d, platform: 'iOS', createdAt: '2025-01-01' })),
    }),
  };
}

describe('useDevicesQuery', () => {
  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
    mockUseCloudConnection.mockReset();
  });

  it('returns ready with the connected user’s devices', async () => {
    mockUseCloudConnection.mockReturnValue({ status: { connected: true, userId: 'user-A' } });
    mockFetch.mockResolvedValue(devicesResponse([{ id: 'd1' }, { id: 'd2' }]));

    const { result } = renderHook(() => useDevicesQuery(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.devices).toHaveLength(2);
  });

  it('scopes the cache by userId so an account switch does not reuse the previous list', async () => {
    // Account A has 2 devices...
    mockUseCloudConnection.mockReturnValue({ status: { connected: true, userId: 'user-A' } });
    mockFetch.mockResolvedValueOnce(devicesResponse([{ id: 'd1' }, { id: 'd2' }]));

    const { result, rerender } = renderHook(() => useDevicesQuery(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.devices).toHaveLength(2);

    // ...switch to account B with 0 devices. With a user-scoped key this is a fresh
    // query; an UNscoped ['cloud','devices'] key would return A's cached (still-fresh)
    // list and wrongly report 2 devices, hiding the CTA.
    mockUseCloudConnection.mockReturnValue({ status: { connected: true, userId: 'user-B' } });
    mockFetch.mockResolvedValueOnce(devicesResponse([]));
    rerender();

    await waitFor(() =>
      expect(result.current.status === 'ready' && result.current.devices.length === 0).toBe(true),
    );
    expect(result.current.devices).toHaveLength(0);
  });

  it('never fetches when not connected (query disabled)', () => {
    mockUseCloudConnection.mockReturnValue({ status: { connected: false } });
    mockFetch.mockResolvedValue(devicesResponse([{ id: 'd1' }]));

    const { result } = renderHook(() => useDevicesQuery(), { wrapper: makeWrapper() });

    // enabled:false → the query never fires. With no data and isLoading=false (RQ v5
    // disabled contract) the hook reports a non-`ready` state, so no false device count.
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.status).not.toBe('ready');
    expect(result.current.devicesAvailable).toBe(false);
  });
});
