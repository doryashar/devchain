import type { Connector, ConnectorStatusMapping, Epic } from '../../storage/models/domain.models';

export interface NormalizedExternalTask {
  externalId: string;
  title: string;
  description: string | null;
  statusId: string | null;
  tags: string[];
  parentId: string | null;
  assigneeName: string | null;
  updatedAt: string;
}

export interface NormalizedExternalComment {
  externalId: string;
  taskExternalId: string;
  content: string;
  authorName: string;
  createdAt: string;
}

export interface InboundEvent {
  action: 'created' | 'updated' | 'deleted' | 'comment_created';
  externalId: string;
  fields?: Partial<NormalizedExternalTask>;
  comment?: NormalizedExternalComment;
  timestamp: string;
}

export interface PushEpicInput {
  epic: Epic;
  statusMappings: ConnectorStatusMapping[];
  syncState: { externalId: string | null; lastSyncedAt: string | null };
}

export interface PushEpicResult {
  externalId: string;
  success: boolean;
  error?: string;
}

export interface PushCommentInput {
  epicExternalId: string;
  commentId: string;
  content: string;
  authorName: string;
}

export interface ConnectorAdapter {
  readonly type: string;

  testConnection(config: Connector['config']): Promise<{ success: boolean; error?: string }>;

  listRemoteProjects(config: Connector['config']): Promise<{ id: string; name: string }[]>;

  pushEpic(input: PushEpicInput, config: Connector['config']): Promise<PushEpicResult>;

  pullEpic(externalId: string, config: Connector['config']): Promise<NormalizedExternalTask | null>;

  pushComment(input: PushCommentInput, config: Connector['config']): Promise<void>;

  resolveWebhook(payload: unknown, config: Connector['config']): Promise<InboundEvent | null>;
}
