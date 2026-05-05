import { Module } from '@nestjs/common';
import { ClaudeAdapter } from './claude.adapter';
import { CodexAdapter } from './codex.adapter';
import { GeminiAdapter } from './gemini.adapter';
import { OpencodeAdapter } from './opencode.adapter';
import { ProviderAdapterFactory } from './provider-adapter.factory';
import { StorageModule } from '../../storage/storage.module';

/**
 * ProviderAdaptersModule
 *
 * Encapsulates provider adapters and factory to break the circular dependency
 * between CoreNormalModule and ProvidersModule. Both modules can import this module
 * without creating a dependency cycle.
 *
 * StorageModule is imported because ProviderAdapterFactory injects STORAGE_SERVICE
 * for the getPostPasteDelayMsForAgent resolver (agent → config → provider chain).
 */
@Module({
  imports: [StorageModule],
  providers: [ClaudeAdapter, CodexAdapter, GeminiAdapter, OpencodeAdapter, ProviderAdapterFactory],
  exports: [ProviderAdapterFactory],
})
export class ProviderAdaptersModule {}
