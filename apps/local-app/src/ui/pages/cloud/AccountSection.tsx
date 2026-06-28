import { useState, useCallback } from 'react';
import { Cloud, LogOut, RefreshCw } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { ConfirmDialog } from '@/ui/components/shared/ConfirmDialog';
import { CloudAuthForm } from '@/ui/components/cloud/CloudAuthForm';
import { SignInMobileDeviceDialog } from '@/ui/components/cloud/SignInMobileDeviceDialog';
import { PairedDevicesCard } from '@/ui/components/cloud/PairedDevicesCard';
import { AppDownloadCard } from '@/ui/components/cloud/AppDownloadCard';
import { useCloudConnection } from '@/ui/hooks/useCloudConnection';
import type { CloudConnectionStatus } from '@/modules/cloud/types';

export function AccountSection() {
  const { status, isLoading, disconnect } = useCloudConnection();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Cloud className="h-4 w-4 animate-pulse" />
        Checking connection...
      </div>
    );
  }

  if (!status.connected) {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          <div className="rounded-xl border border-border bg-card shadow-sm p-6 lg:p-8 space-y-5">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Cloud className="h-5 w-5 text-muted-foreground" />
                <span className="text-base font-semibold">Connect to DevChain Cloud</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Sign in to enable cloud notifications, project forwarding, and mobile access.
              </p>
            </div>
            <CloudAuthForm identityServiceUrl={status.identityServiceUrl} />
          </div>
        </div>
        {/* Signed-out: a device check is impossible/irrelevant, so always offer the download CTA. */}
        <div className="min-w-0">
          <AppDownloadCard />
        </div>
      </div>
    );
  }

  return <ConnectedAccountSection status={status} disconnect={disconnect} />;
}

function ConnectedAccountSection({
  status,
  disconnect,
}: {
  status: CloudConnectionStatus;
  disconnect: () => void;
}) {
  const [showDisconnect, setShowDisconnect] = useState(false);

  const handleSwitch = useCallback(() => {
    disconnect();
    const redirectUri = window.location.origin + '/auth/cloud/callback';
    const url = `${status.identityServiceUrl}/auth/github?response_mode=fragment_full&redirect_uri=${encodeURIComponent(redirectUri)}`;
    setTimeout(() => {
      window.open(url, 'devchain-cloud-auth', 'width=600,height=700');
    }, 100);
  }, [status.identityServiceUrl, disconnect]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="min-w-0 space-y-6">
        <div className="rounded-xl border border-border bg-card shadow-sm p-6 lg:p-8 space-y-6">
          <div
            role="status"
            aria-label="Cloud account connected"
            className="flex items-center gap-2"
          >
            <Cloud className="h-5 w-5 text-green-500" />
            <span className="text-base font-semibold">Connected</span>
          </div>
          <dl className="divide-y divide-border border-y border-border">
            {status.email && (
              <div className="grid grid-cols-1 sm:grid-cols-[180px,minmax(0,1fr)] sm:items-center gap-1 sm:gap-4 py-4">
                <dt className="text-sm font-medium text-muted-foreground">Email</dt>
                <dd className="min-w-0 truncate text-sm sm:text-right" title={status.email}>
                  {status.email}
                </dd>
              </div>
            )}
            {status.userId && (
              <div className="grid grid-cols-1 sm:grid-cols-[180px,minmax(0,1fr)] sm:items-center gap-1 sm:gap-4 py-4">
                <dt className="text-sm font-medium text-muted-foreground">User ID</dt>
                <dd className="min-w-0 font-mono text-xs sm:text-right" title={status.userId}>
                  {status.userId.slice(0, 8)}...
                </dd>
              </div>
            )}
            {status.identityServiceUrl && (
              <div className="grid grid-cols-1 sm:grid-cols-[180px,minmax(0,1fr)] sm:items-center gap-1 sm:gap-4 py-4">
                <dt className="text-sm font-medium text-muted-foreground">Service</dt>
                <dd
                  className="min-w-0 truncate text-xs sm:text-right"
                  title={status.identityServiceUrl}
                >
                  {status.identityServiceUrl}
                </dd>
              </div>
            )}
          </dl>
        </div>

        <div className="mt-6 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <Button variant="outline" size="default" onClick={handleSwitch}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Switch account
            </Button>
            <Button variant="outline" size="default" onClick={() => setShowDisconnect(true)}>
              <LogOut className="mr-2 h-4 w-4" />
              Disconnect
            </Button>
          </div>

          <SignInMobileDeviceDialog
            identityServiceUrl={status.identityServiceUrl}
            triggerSize="default"
            triggerClassName="w-full sm:w-[480px] border-primary text-primary hover:bg-primary/5"
          />
        </div>

        <PairedDevicesCard />

        <ConfirmDialog
          open={showDisconnect}
          onOpenChange={setShowDisconnect}
          onConfirm={disconnect}
          title="Disconnect from DevChain Cloud?"
          description="Local devices stay paired, but cloud features (notifications, project forwarding, mobile sign-in) will stop until you reconnect."
          confirmText="Disconnect"
          cancelText="Cancel"
          variant="destructive"
        />
      </div>

      {/* Always offered, even with devices already registered (e.g. for a second phone). */}
      <div className="min-w-0" data-testid="mobile-setup-column">
        {/* h-full keeps the card level with the Connected column. Steps live inside the
            card; this download dialog is distinct from the "Sign in mobile device" QR dialog. */}
        <AppDownloadCard className="h-full">
          <ol className="space-y-0.5 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">1.</span> Download the app on your phone
              (below)
            </li>
            <li>
              <span className="font-medium text-foreground">2.</span> Sign in your phone via QR (use
              &ldquo;Sign in mobile device&rdquo;)
            </li>
          </ol>
        </AppDownloadCard>
      </div>
    </div>
  );
}
