import { Injectable } from '@nestjs/common';
import type {
  ProviderAdapter,
  AddMcpServerOptions,
  McpServerEntry,
  BuildLaunchArgsInput,
  TerminalOutputBehavior,
} from './provider-adapter.interface';

@Injectable()
export class OpencodeAdapter implements ProviderAdapter {
  readonly providerName = 'opencode';
  readonly mcpMode = 'project_config' as const;
  readonly configFileName = 'opencode.json';

  // OpenCode is a full-screen TUI: keep the terminal alternate screen on and
  // preserve its `?1049;1000h` (alt-screen + mouse-tracking) so wheel events pass
  // through to the TUI instead of scrolling our scrollback. Every other provider
  // leaves this unset (default false) and keeps alt-screen suppressed.
  readonly terminalOutputBehavior: TerminalOutputBehavior = { usesAlternateScreen: true };

  // TranscriptDiscoveryCapability — OpenCode is DB-backed: discovery is a
  // structured SQL match (handled by the DB-aware path in the persistence
  // listener), and restore needs the `ses_…` id (`--session <id>`).
  readonly transcriptDiscoveryStrategy = 'all' as const;
  readonly providerSessionIdRequiredForRestore = true;

  addMcpServer(_options: AddMcpServerOptions): string[] {
    // OpenCode MCP is managed via opencode.json config file, not CLI.
    // Return version check as safe no-op fallback.
    return ['--version'];
  }

  listMcpServers(): string[] {
    return ['mcp', 'list'];
  }

  removeMcpServer(_alias: string): string[] {
    // OpenCode has no mcp remove command; managed via config file.
    return ['--version'];
  }

  binaryCheck(_alias: string): string[] {
    return ['--version'];
  }

  buildLaunchArgs({ mode, providerSessionId, profileOptionArgs }: BuildLaunchArgsInput): {
    argv: string[];
  } {
    if (mode === 'restore') {
      return { argv: ['--session', providerSessionId!, ...profileOptionArgs] };
    }
    return { argv: [...profileOptionArgs] };
  }

  parseListOutput(_stdout: string, _stderr?: string): McpServerEntry[] {
    // OpenCode mcp list outputs TUI-formatted text with box-drawing chars.
    // Config-file mode reads opencode.json directly instead.
    return [];
  }

  /**
   * Parse MCP entries from opencode.json config file content.
   * Caller is responsible for handling JSON parse errors.
   */
  parseProjectConfig(content: string): McpServerEntry[] {
    const config = JSON.parse(content);
    const mcp = config?.mcp;
    if (!mcp || typeof mcp !== 'object') return [];

    const entries: McpServerEntry[] = [];
    for (const [alias, serverConfig] of Object.entries(mcp)) {
      const cfg = serverConfig as Record<string, unknown>;
      if (cfg?.url && typeof cfg.url === 'string') {
        entries.push({
          alias,
          endpoint: cfg.url,
          transport: typeof cfg.type === 'string' ? cfg.type.toUpperCase() : 'REMOTE',
        });
      }
    }
    return entries;
  }

  /**
   * Build the MCP config entry to write into opencode.json.
   */
  buildMcpConfigEntry(options: AddMcpServerOptions): {
    key: string;
    value: Record<string, unknown>;
  } {
    return {
      key: options.alias ?? 'devchain',
      value: {
        type: 'remote',
        url: options.endpoint,
      },
    };
  }
}
