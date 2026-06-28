import { useCallback, useEffect, useState } from 'react';

/**
 * Renderer hook for the desktop "Paired devices" surface (E2EE trust).
 *
 * Lists the paired peer devices (metadata only) from `GET /api/e2ee/devices`, and exposes
 * an on-demand `fetchSafetyNumber(kid)` so the order-independent safety number is computed
 * by the backend ONLY when the user asks to compare it (it is never bulk-loaded). The number
 * the PC renders is identical to the one the phone's "Validate this device" screen shows.
 */
export interface PairedDevice {
  kid: string;
  label?: string;
  trust: 'verified' | 'unverified';
  adoptedVia?: 'qr' | 'email-tofu';
  verifiedVia?: 'qr' | 'email-tofu' | 'safety-number';
  verifiedAt?: string;
  addedAt: string;
}

export interface UsePairedDevices {
  devices: PairedDevice[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** Fetch the safety number for one device on demand (computed by the backend per call). */
  fetchSafetyNumber: (kid: string) => Promise<string>;
  /** Un-pair (remove) a device, then refresh the list. */
  unpairDevice: (kid: string) => Promise<void>;
}

export function usePairedDevices(): UsePairedDevices {
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/e2ee/devices');
      if (!res.ok) throw new Error(`devices:${res.status}`);
      const data = (await res.json()) as PairedDevice[];
      setDevices(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const fetchSafetyNumber = useCallback(async (kid: string): Promise<string> => {
    const res = await fetch(`/api/e2ee/devices/${encodeURIComponent(kid)}/safety-number`);
    if (!res.ok) throw new Error(`safety-number:${res.status}`);
    const { safetyNumber } = (await res.json()) as { safetyNumber?: string };
    if (!safetyNumber) throw new Error('No safety number returned');
    return safetyNumber;
  }, []);

  const unpairDevice = useCallback(
    async (kid: string): Promise<void> => {
      const res = await fetch(`/api/e2ee/devices/${encodeURIComponent(kid)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`unpair:${res.status}`);
      await reload();
    },
    [reload],
  );

  return { devices, loading, error, reload, fetchSafetyNumber, unpairDevice };
}
