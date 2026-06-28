import { useCallback, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { ConfirmDialog } from '@/ui/components/shared/ConfirmDialog';
import { cn } from '@/ui/lib/utils';
import { usePairedDevices, type PairedDevice } from '@/ui/hooks/usePairedDevices';

/**
 * Desktop "Paired devices" card — lists the phones/devices paired with this account and lets
 * the user reveal each one's E2EE safety number on demand to compare with the phone's
 * "Validate this device" screen. Read-only: marking a device verified happens on the phone.
 * Fills the gap where, after a magic-link (email-TOFU) login, the safety number was only
 * shown in the QR pairing dialog — this surfaces it for ANY login method.
 */
export function PairedDevicesCard({ className }: { className?: string }) {
  const { devices, loading, error, reload, fetchSafetyNumber, unpairDevice } = usePairedDevices();
  const [pendingRemoval, setPendingRemoval] = useState<PairedDevice | null>(null);

  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card shadow-sm p-6 lg:p-8 space-y-4',
        className,
      )}
      data-testid="paired-devices-card"
    >
      <div className="flex items-center gap-2">
        <Smartphone className="h-5 w-5 text-muted-foreground" />
        <span className="text-base font-semibold">Paired devices</span>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Checking paired devices…</p>
      ) : error ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Couldn’t load paired devices.</p>
          <Button variant="outline" size="sm" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      ) : devices.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No devices paired yet. Sign in a phone to compare its safety number here.
        </p>
      ) : (
        <div className="divide-y divide-border border-y border-border">
          {devices.map((device) => (
            <DeviceRow
              key={device.kid}
              device={device}
              fetchSafetyNumber={fetchSafetyNumber}
              onUnpair={() => setPendingRemoval(device)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoval(null);
        }}
        onConfirm={() => {
          if (pendingRemoval) void unpairDevice(pendingRemoval.kid);
        }}
        title="Un-pair this device?"
        description={`Remove "${pendingRemoval?.label ?? 'this device'}" from your paired devices. Handy for clearing stale entries from old app installs. If it is still your active phone, encryption re-establishes automatically the next time it connects.`}
        confirmText="Un-pair"
        cancelText="Cancel"
        variant="destructive"
      />
    </div>
  );
}

function trustBadge(device: PairedDevice): {
  text: string;
  variant: 'default' | 'secondary';
} {
  return device.trust === 'verified'
    ? { text: 'Verified', variant: 'default' }
    : { text: 'Trusted on first use', variant: 'secondary' };
}

function formatPairedDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

function DeviceRow({
  device,
  fetchSafetyNumber,
  onUnpair,
}: {
  device: PairedDevice;
  fetchSafetyNumber: (kid: string) => Promise<string>;
  onUnpair: () => void;
}) {
  const [shown, setShown] = useState(false);
  const [safetyNumber, setSafetyNumber] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(async () => {
    if (shown) {
      setShown(false);
      return;
    }
    setShown(true);
    if (safetyNumber) return; // already fetched once — reveal without re-fetching
    setBusy(true);
    setError(null);
    try {
      setSafetyNumber(await fetchSafetyNumber(device.kid));
    } catch {
      setError('Couldn’t load the safety number for this device.');
    } finally {
      setBusy(false);
    }
  }, [shown, safetyNumber, device.kid, fetchSafetyNumber]);

  const badge = trustBadge(device);

  return (
    <div className="py-4 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{device.label ?? 'Mobile device'}</span>
            <Badge variant={badge.variant}>{badge.text}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">Paired {formatPairedDate(device.addedAt)}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => void toggle()} disabled={busy}>
            {shown ? 'Hide' : busy ? 'Loading…' : 'Show safety number'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={onUnpair}
            aria-label={`Un-pair ${device.label ?? 'device'}`}
          >
            Un-pair
          </Button>
        </div>
      </div>

      {shown && safetyNumber && (
        <div className="space-y-1" data-testid="device-safety-number">
          <code className="block text-sm font-mono tracking-wide font-semibold leading-6 break-all">
            {safetyNumber}
          </code>
          <p className="text-xs text-muted-foreground">
            Should match the “Validate this device” number on your phone.
          </p>
        </div>
      )}
      {shown && error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
