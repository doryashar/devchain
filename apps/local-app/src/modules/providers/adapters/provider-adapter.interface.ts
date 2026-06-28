export interface McpServerEntry {
  alias: string;
  endpoint: string;
  transport?: string;
}

export interface LaunchInitialPromptBehavior {
  preKeys?: string[];
  preDelayMs?: number;
}

export interface RuntimePromptBehavior {
  postPasteDelayMs?: number;
}

export interface TerminalOutputBehavior {
  /**
   * When true, the adapter emits raw VT-style output: bare LF means
   * cursor-down-only, cursor positioning is done explicitly via CSI sequences,
   * and the terminal pipeline must NOT add CR before LF. When undefined or
   * false, the pipeline normalizes bare LFs to CRLF on the server side
   * (required because xterm.js runs with convertEol:false for Claude's sake).
   */
  rawLineEndings?: boolean;
  /**
   * When true, the provider runs as a full-screen TUI that legitimately uses the
   * terminal alternate screen. The terminal pipeline then KEEPS alt-screen on
   * (tmux `alternate-screen on`) and does NOT strip the `?1049/?1047/?47` DECSET
   * toggles from the PTY stream — critical because TUIs emit a combined
   * `ESC[?1049;1000h` (alt-screen + mouse-tracking) and stripping the whole DECSET
   * would drop mouse-tracking as collateral, breaking wheel passthrough. When
   * undefined or false, alt-screen is suppressed (tmux `alternate-screen off` and
   * the strip stays active) so line-streaming CLIs accumulate scrollback — the
   * broader, safer default.
   */
  usesAlternateScreen?: boolean;
}

export interface AddMcpServerOptions {
  endpoint: string;
  alias?: string;
  extraArgs?: string[];
}

export interface BuildLaunchArgsInput {
  mode: 'new' | 'restore';
  providerSessionId?: string;
  profileOptionArgs: string[];
}

export interface ProviderAdapter {
  readonly providerName: string;
  readonly launchInitialPromptBehavior?: LaunchInitialPromptBehavior;
  readonly runtimePromptBehavior?: RuntimePromptBehavior;
  readonly terminalOutputBehavior?: TerminalOutputBehavior;
  /**
   * Environment variables the provider needs cleared from its launch
   * environment (passed to `env -u <KEY>`). Lets a provider opt out of
   * inherited vars without callers hardcoding provider-specific behavior.
   */
  readonly launchUnsetEnv?: readonly string[];
  buildLaunchArgs(input: BuildLaunchArgsInput): { argv: string[] };
}
