/**
 * Mobile-app download links + per-store presentation metadata for the
 * "Get the DevChain mobile app" CTA on Cloud Settings (`/cloud?section=account`).
 *
 * These are BETA distribution channels, not production store listings:
 *  - iOS  → TestFlight open-beta join link
 *  - Android → Google Play open-testing link
 *
 * The QR codes encode the plain store URL (phone camera → opens TestFlight / Play).
 * No auth payloads are involved — this is NOT the QR sign-in flow.
 */

/** Store identifiers used as keys and test ids throughout the download CTA. */
export type AppStoreId = 'ios' | 'android';

/** Exact store URLs. Encoded in the QR and used as the direct anchor href. */
export const APP_DOWNLOAD_LINKS: Record<AppStoreId, string> = {
  ios: 'https://testflight.apple.com/join/VSbfE1c6',
  android: 'https://play.google.com/apps/testing/com.twitech.devchain.mobile',
};

export interface AppDownloadStore {
  /** Stable identifier (`ios` | `android`). */
  id: AppStoreId;
  /** Primary platform label, e.g. "App Store". */
  label: string;
  /** Honest beta-channel qualifier shown on the button, e.g. "TestFlight beta". */
  channel: string;
  /** Explicit accessible name for the trigger button. */
  ariaLabel: string;
  /** Download-specific dialog title — must not be confusable with the QR sign-in dialog. */
  dialogTitle: string;
  /** Plain store URL (same value used for the QR and the direct link). */
  url: string;
}

/** Ordered store descriptors rendered by AppDownloadCard. */
export const APP_DOWNLOAD_STORES: readonly AppDownloadStore[] = [
  {
    id: 'ios',
    label: 'App Store',
    channel: 'TestFlight beta',
    ariaLabel: 'Download from the App Store (TestFlight beta)',
    dialogTitle: 'Download the app — App Store',
    url: APP_DOWNLOAD_LINKS.ios,
  },
  {
    id: 'android',
    label: 'Google Play',
    channel: 'Open beta',
    ariaLabel: 'Download from Google Play (open beta)',
    dialogTitle: 'Download the app — Google Play',
    url: APP_DOWNLOAD_LINKS.android,
  },
];
