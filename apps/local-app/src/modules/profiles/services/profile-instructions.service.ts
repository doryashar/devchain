import { Injectable, Inject } from '@nestjs/common';
import { StorageService, STORAGE_SERVICE } from '../../storage/interfaces/storage.interface';
import { InstructionsResolver } from '../../mcp/services/instructions-resolver';
import { buildInlineResolution } from '../../mcp/services/utils/document-link-resolver';

@Injectable()
export class ProfileInstructionsService {
  private readonly resolver: InstructionsResolver;

  constructor(@Inject(STORAGE_SERVICE) private readonly storage: StorageService) {
    this.resolver = new InstructionsResolver(this.storage, (document, cache, maxDepth, maxBytes) =>
      buildInlineResolution(this.storage, document, cache, maxDepth, maxBytes),
    );
  }

  getResolver(): InstructionsResolver {
    return this.resolver;
  }
}
