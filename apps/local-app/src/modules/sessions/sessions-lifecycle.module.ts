import { Module } from '@nestjs/common';
import { SessionsModule } from './sessions.module';
import { SessionLifecycleFacade } from './services/session-lifecycle-facade.service';

/**
 * Narrow facade module exposing session lifecycle (launch/restart/restore/
 * terminate) to consumers that must not pull the broad SessionsModule directly
 * (e.g. CloudTunnelModule / mobile chat). Leaf consumer of the allowlisted
 * Sessions↔Terminal SCC — no service is provided back, so no new cycle.
 */
@Module({
  imports: [SessionsModule],
  providers: [SessionLifecycleFacade],
  exports: [SessionLifecycleFacade],
})
export class SessionsLifecycleModule {}
