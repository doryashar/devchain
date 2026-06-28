import { MODULE_METADATA } from '@nestjs/common/constants';
import { CloudModule } from '../cloud/cloud.module';
import { StorageModule } from '../storage/storage.module';
import { SessionsReadModule } from '../sessions/sessions-read.module';
import { SessionsLifecycleModule } from '../sessions/sessions-lifecycle.module';
import { SessionReaderModule } from '../session-reader/session-reader.module';
import { AgentMessageDeliveryModule } from '../agent-message-delivery/agent-message-delivery.module';
import { TeamsModule } from '../teams/teams.module';
import { EpicsModule } from '../epics/epics.module';
import { CloudTunnelModule } from './cloud-tunnel.module';
import { MobileChatRpcService } from './services/mobile-chat-rpc.service';
import { MobileBoardRpcService } from './services/mobile-board-rpc.service';
import { LifecycleOperationTracker } from './services/lifecycle-operation-tracker';
import { TunnelEventForwarderService } from './services/tunnel-event-forwarder.service';

describe('CloudTunnelModule', () => {
  const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, CloudTunnelModule) ??
    []) as unknown[];
  const providers = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, CloudTunnelModule) ??
    []) as unknown[];

  it('imports dependencies required by tunnel services', () => {
    expect(imports).toContain(CloudModule);
    expect(imports).toContain(StorageModule);
  });

  it('imports only the narrow facade modules for mobile chat', () => {
    expect(imports).toContain(SessionsReadModule);
    expect(imports).toContain(SessionsLifecycleModule);
    expect(imports).toContain(SessionReaderModule);
    expect(imports).toContain(AgentMessageDeliveryModule);
  });

  it('imports TeamsModule so MobileChatRpcService can inject TeamsService (chat.listTeams)', () => {
    // TeamsModule exports TeamsService only (not TeamsStore); importing it here
    // is what makes `teamsService: TeamsService` resolvable in MobileChatRpcService.
    expect(imports).toContain(TeamsModule);
  });

  it('imports EpicsModule so MobileBoardRpcService can inject EpicsService (board.* mutations)', () => {
    // EpicsModule exports EpicsService; importing it makes `epicsService:
    // EpicsService` resolvable in MobileBoardRpcService (mutations via the
    // service, not raw storage).
    expect(imports).toContain(EpicsModule);
  });

  it('registers MobileChatRpcService + MobileBoardRpcService + LifecycleOperationTracker', () => {
    expect(providers).toContain(MobileChatRpcService);
    expect(providers).toContain(MobileBoardRpcService);
    expect(providers).toContain(LifecycleOperationTracker);
  });

  it('registers TunnelEventForwarderService (push events up the tunnel)', () => {
    expect(providers).toContain(TunnelEventForwarderService);
  });
});
