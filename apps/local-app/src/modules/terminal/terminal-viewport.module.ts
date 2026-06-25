import { Module } from '@nestjs/common';
import { TerminalModule } from './terminal.module';
import { ProcessExecutorModule } from './services/process-executor/process-executor.module';
import { TerminalViewportFacade } from './services/terminal-viewport/terminal-viewport.facade';

/**
 * NARROW facade module for the live viewport. Imports `TerminalModule` (for
 * `TerminalSessionRegistry`) and `ProcessExecutorModule` (for the tmux capture executor),
 * but exports ONLY {@link TerminalViewportFacade}.
 *
 * `CloudTunnelModule` imports THIS module — not `TerminalModule` wholesale — so it stays a
 * leaf/transitive consumer of the Sessions↔Terminal SCC with no back-edge (no Sessions or
 * Terminal module imports CloudTunnel or this module). See docs/cycle-allowlist.md (~65-76).
 */
@Module({
  imports: [TerminalModule, ProcessExecutorModule],
  providers: [TerminalViewportFacade],
  exports: [TerminalViewportFacade],
})
export class TerminalViewportModule {}
