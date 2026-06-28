import { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { cn } from '@/ui/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog';
import { useQrAuth } from '../../hooks/useQrAuth';
import { QrDisplayPanel } from './QrDisplayPanel';

interface SignInMobileDeviceDialogProps {
  identityServiceUrl: string;
  /** Additional class names appended to the trigger button (merged via cn). */
  triggerClassName?: string;
  /** Size variant for the trigger button. Defaults to 'sm' (existing behaviour). */
  triggerSize?: 'sm' | 'default' | 'lg';
}

export function SignInMobileDeviceDialog({
  identityServiceUrl,
  triggerClassName,
  triggerSize = 'sm',
}: SignInMobileDeviceDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size={triggerSize}
          className={cn(triggerClassName)}
          data-testid="sign-in-mobile-device-button"
        >
          Sign in mobile device
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign in your mobile with this account</DialogTitle>
          <DialogDescription>
            Scan from the DevChain mobile app to sign in your phone.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <QrAuthDialogBody
            identityServiceUrl={identityServiceUrl}
            onClose={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function QrAuthDialogBody({
  identityServiceUrl,
  onClose,
}: {
  identityServiceUrl: string;
  onClose: () => void;
}) {
  const qr = useQrAuth(identityServiceUrl, 'provision');

  useEffect(() => {
    qr.start();
  }, []);

  useEffect(() => {
    if (qr.status === 'success') {
      const timer = setTimeout(onClose, 1500);
      return () => clearTimeout(timer);
    }
  }, [qr.status, onClose]);

  return (
    <QrDisplayPanel
      {...qr}
      onCancel={() => {
        qr.cancel();
        onClose();
      }}
      onRetry={qr.retry}
    />
  );
}
