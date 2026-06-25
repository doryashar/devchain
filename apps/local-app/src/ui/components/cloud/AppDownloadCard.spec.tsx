/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppDownloadCard } from './AppDownloadCard';
import { APP_DOWNLOAD_LINKS } from '@/ui/lib/app-downloads';

// Mock QRCodeSVG: assert the `value` prop, never snapshot SVG internals.
jest.mock('qrcode.react', () => ({
  QRCodeSVG: ({
    value,
    bgColor,
    fgColor,
    includeMargin,
    marginSize,
  }: {
    value: string;
    bgColor?: string;
    fgColor?: string;
    includeMargin?: boolean;
    marginSize?: number;
  }) => (
    <div
      data-testid="qr-code-svg"
      data-value={value}
      data-bg-color={bgColor}
      data-fg-color={fgColor}
      data-include-margin={String(includeMargin)}
      data-margin-size={String(marginSize)}
    />
  ),
}));

const toastSpy = jest.fn();
jest.mock('@/ui/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastSpy }),
}));

const IOS_LABEL = 'Download from the App Store (TestFlight beta)';
const ANDROID_LABEL = 'Download from Google Play (open beta)';

function setClipboard(impl: { writeText?: jest.Mock } | undefined) {
  Object.defineProperty(navigator, 'clipboard', {
    value: impl,
    configurable: true,
    writable: true,
  });
}

describe('AppDownloadCard', () => {
  beforeEach(() => {
    toastSpy.mockReset();
    setClipboard({ writeText: jest.fn().mockResolvedValue(undefined) });
  });

  it('renders heading, beta copy, and both store buttons with accessible names', () => {
    render(<AppDownloadCard />);
    expect(screen.getByText('Get the DevChain mobile app')).toBeInTheDocument();
    expect(screen.getByText(/currently in open beta/i)).toBeInTheDocument();

    expect(screen.getByRole('button', { name: IOS_LABEL })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ANDROID_LABEL })).toBeInTheDocument();
  });

  it('marks the decorative brand glyphs as aria-hidden', () => {
    const { container } = render(<AppDownloadCard />);
    const iosBtn = screen.getByRole('button', { name: IOS_LABEL });
    const androidBtn = screen.getByRole('button', { name: ANDROID_LABEL });
    expect(iosBtn.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
    expect(androidBtn.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
    // No store glyph should be exposed to assistive tech.
    expect(container.querySelectorAll('svg:not([aria-hidden="true"])').length).toBe(0);
  });

  it('opens the iOS dialog with the TestFlight URL as the QR value and anchor href', async () => {
    render(<AppDownloadCard />);
    fireEvent.click(screen.getByRole('button', { name: IOS_LABEL }));

    expect(await screen.findByText('Download the app — App Store')).toBeInTheDocument();

    const qr = screen.getByTestId('qr-code-svg');
    expect(qr).toHaveAttribute('data-value', APP_DOWNLOAD_LINKS.ios);
    expect(qr).toHaveAttribute('data-bg-color', '#ffffff');
    expect(qr).toHaveAttribute('data-fg-color', '#000000');
    expect(qr).toHaveAttribute('data-margin-size', '4');

    const link = screen.getByTestId('app-download-link-ios');
    expect(link).toHaveAttribute('href', APP_DOWNLOAD_LINKS.ios);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveTextContent(APP_DOWNLOAD_LINKS.ios);
    // break-all (not break-words): a long unbreakable URL must reduce the dialog
    // grid's min-content width, otherwise the content overflows the dialog box.
    expect(link.className).toContain('break-all');
  });

  it('opens the Android dialog with the Play open-testing URL as the QR value and anchor href', async () => {
    render(<AppDownloadCard />);
    fireEvent.click(screen.getByRole('button', { name: ANDROID_LABEL }));

    expect(await screen.findByText('Download the app — Google Play')).toBeInTheDocument();

    const qr = screen.getByTestId('qr-code-svg');
    expect(qr).toHaveAttribute('data-value', APP_DOWNLOAD_LINKS.android);

    const link = screen.getByTestId('app-download-link-android');
    expect(link).toHaveAttribute('href', APP_DOWNLOAD_LINKS.android);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('uses download-specific dialog titles distinct from the QR sign-in dialog', async () => {
    render(<AppDownloadCard />);
    fireEvent.click(screen.getByRole('button', { name: IOS_LABEL }));
    const title = await screen.findByText('Download the app — App Store');
    // Must not be confusable with the existing "Sign in your mobile with this account" dialog.
    expect(title.textContent).not.toMatch(/sign in/i);
  });

  it('copies the store URL and shows success feedback', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    render(<AppDownloadCard />);
    fireEvent.click(screen.getByRole('button', { name: IOS_LABEL }));
    await screen.findByText('Download the app — App Store');

    fireEvent.click(screen.getByTestId('app-download-copy-ios'));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(APP_DOWNLOAD_LINKS.ios);
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Link copied' }));
    });
  });

  it('shows failure feedback when clipboard.writeText rejects (no crash)', async () => {
    const writeText = jest.fn().mockRejectedValue(new Error('denied'));
    setClipboard({ writeText });

    render(<AppDownloadCard />);
    fireEvent.click(screen.getByRole('button', { name: ANDROID_LABEL }));
    await screen.findByText('Download the app — Google Play');

    fireEvent.click(screen.getByTestId('app-download-copy-android'));

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive', title: 'Could not copy link' }),
      );
    });
  });

  it('degrades gracefully when the clipboard API is absent', async () => {
    setClipboard(undefined);

    render(<AppDownloadCard />);
    fireEvent.click(screen.getByRole('button', { name: IOS_LABEL }));
    await screen.findByText('Download the app — App Store');

    // Should not throw; surfaces the failure toast instead.
    fireEvent.click(screen.getByTestId('app-download-copy-ios'));

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
    });
  });

  it('keeps each store button scoped to its own dialog instance', () => {
    render(<AppDownloadCard />);
    const card = screen.getByTestId('app-download-card');
    // Both triggers live inside the card before any dialog opens.
    expect(within(card).getByRole('button', { name: IOS_LABEL })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: ANDROID_LABEL })).toBeInTheDocument();
    // No QR is rendered until a dialog opens.
    expect(screen.queryByTestId('qr-code-svg')).not.toBeInTheDocument();
  });
});
