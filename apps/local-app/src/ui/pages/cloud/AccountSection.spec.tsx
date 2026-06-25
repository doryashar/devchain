import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountSection } from './AccountSection';

const mockUseCloudConnection = jest.fn();
jest.mock('@/ui/hooks/useCloudConnection', () => ({
  useCloudConnection: () => mockUseCloudConnection(),
}));

jest.mock('@/ui/components/cloud/CloudAuthForm', () => ({
  CloudAuthForm: ({ identityServiceUrl }: { identityServiceUrl: string }) => (
    <div data-testid="cloud-auth-form">Connect {identityServiceUrl}</div>
  ),
}));

// Stub the (separately tested) download card so these tests stay focused on gating/layout.
// Children are rendered so the setup steps passed into the card stay assertable.
jest.mock('@/ui/components/cloud/AppDownloadCard', () => ({
  AppDownloadCard: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="app-download-card">{children}</div>
  ),
}));

jest.mock('@/ui/components/shared/ConfirmDialog', () => ({
  ConfirmDialog: ({
    open,
    onOpenChange,
    onConfirm,
    title,
  }: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    onConfirm: () => void;
    title: string;
  }) => {
    if (!open) return null;
    return (
      <div data-testid="confirm-dialog">
        <p>{title}</p>
        <button data-testid="confirm-dialog-cancel" onClick={() => onOpenChange(false)}>
          Cancel
        </button>
        <button data-testid="confirm-dialog-confirm" onClick={onConfirm}>
          Confirm
        </button>
      </div>
    );
  },
}));

const DISCONNECTED = {
  status: { connected: false, identityServiceUrl: 'http://localhost:3002' },
  isLoading: false,
  disconnect: jest.fn(),
};

const CONNECTED = {
  status: {
    connected: true,
    identityServiceUrl: 'http://localhost:3002',
    email: 'user@example.com',
    userId: 'user-abc12345',
  },
  isLoading: false,
  disconnect: jest.fn(),
};

const LOADING = {
  status: { connected: false, identityServiceUrl: '' },
  isLoading: true,
  disconnect: jest.fn(),
};

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AccountSection />
    </QueryClientProvider>,
  );
}

describe('AccountSection', () => {
  beforeEach(() => {
    mockUseCloudConnection.mockReset();
  });

  it('shows loading state while checking connection', () => {
    mockUseCloudConnection.mockReturnValue(LOADING);
    renderSection();
    expect(screen.getByText('Checking connection...')).toBeInTheDocument();
  });

  it('shows auth form when signed out', () => {
    mockUseCloudConnection.mockReturnValue(DISCONNECTED);
    renderSection();
    expect(screen.getByTestId('cloud-auth-form')).toBeInTheDocument();
  });

  it('wraps the signed-out auth form in a titled card', () => {
    mockUseCloudConnection.mockReturnValue(DISCONNECTED);
    renderSection();
    expect(screen.getByText('Connect to DevChain Cloud')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Sign in to enable cloud notifications, project forwarding, and mobile access.',
      ),
    ).toBeInTheDocument();
  });

  it('shows account details when signed in', () => {
    mockUseCloudConnection.mockReturnValue(CONNECTED);
    renderSection();

    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('user@example.com')).toBeInTheDocument();
    expect(screen.getByText(/Switch account/)).toBeInTheDocument();
    expect(screen.getByText('Disconnect')).toBeInTheDocument();
  });

  describe('Disconnect confirmation', () => {
    it('clicking Disconnect opens ConfirmDialog and does NOT call disconnect immediately', () => {
      const disconnect = jest.fn();
      mockUseCloudConnection.mockReturnValue({ ...CONNECTED, disconnect });

      renderSection();
      fireEvent.click(screen.getByRole('button', { name: /Disconnect/ }));

      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      expect(screen.getByText('Disconnect from DevChain Cloud?')).toBeInTheDocument();
      expect(disconnect).not.toHaveBeenCalled();
    });

    it('clicking Cancel in the dialog closes it without calling disconnect', () => {
      const disconnect = jest.fn();
      mockUseCloudConnection.mockReturnValue({ ...CONNECTED, disconnect });

      renderSection();
      fireEvent.click(screen.getByRole('button', { name: /Disconnect/ }));
      fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));

      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
      expect(disconnect).not.toHaveBeenCalled();
    });

    it('clicking Confirm in the dialog calls disconnect exactly once', () => {
      const disconnect = jest.fn();
      mockUseCloudConnection.mockReturnValue({ ...CONNECTED, disconnect });

      renderSection();
      fireEvent.click(screen.getByRole('button', { name: /Disconnect/ }));
      fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

      expect(disconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('Download CTA visibility', () => {
    it('signed-out: shows the download card next to the auth form', () => {
      mockUseCloudConnection.mockReturnValue(DISCONNECTED);
      renderSection();
      expect(screen.getByTestId('cloud-auth-form')).toBeInTheDocument();
      expect(screen.getByTestId('app-download-card')).toBeInTheDocument();
    });

    it('signed-in: always shows the card with setup steps inside it (kept even with devices registered)', () => {
      mockUseCloudConnection.mockReturnValue(CONNECTED);
      renderSection();

      const card = screen.getByTestId('app-download-card');
      expect(card).toBeInTheDocument();
      expect(card).toHaveTextContent(/Download the app on your phone/);
      expect(card).toHaveTextContent(/Sign in your phone via QR/);
    });

    it('signed-out: shows the card without the connected-only setup steps', () => {
      mockUseCloudConnection.mockReturnValue(DISCONNECTED);
      renderSection();

      expect(screen.getByTestId('app-download-card')).toBeInTheDocument();
      expect(screen.queryByText(/Sign in your phone via QR/)).not.toBeInTheDocument();
    });
  });
});
