import { Injectable } from '@nestjs/common';
import { createLogger } from '../../../common/logging/logger';
import type {
  ConnectorAdapter,
  InboundEvent,
  NormalizedExternalTask,
  PushEpicInput,
  PushEpicResult,
  PushCommentInput,
} from './connector-adapter.interface';
import type { Connector } from '../../storage/models/domain.models';

const logger = createLogger('TaskimAdapter');

interface TaskimConfig {
  apiUrl: string;
  credentials: { email?: string; password?: string; token?: string };
  workspaceId?: string;
  externalProjectId?: string | null;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

@Injectable()
export class TaskimAdapter implements ConnectorAdapter {
  readonly type = 'taskim';
  private tokenCache = new Map<string, TokenCache>();

  private getConfig(config: Connector['config']): TaskimConfig {
    return config as TaskimConfig;
  }

  private async authenticate(config: TaskimConfig): Promise<string> {
    const cacheKey = config.apiUrl;
    const cached = this.tokenCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.token;
    }

    if (config.credentials.token) {
      this.tokenCache.set(cacheKey, {
        token: config.credentials.token,
        expiresAt: Date.now() + 3600_000,
      });
      return config.credentials.token;
    }

    const response = await fetch(`${config.apiUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: config.credentials.email,
        password: config.credentials.password,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Taskim auth failed: ${error}`);
    }

    const data = (await response.json()) as { accessToken: string };
    this.tokenCache.set(cacheKey, {
      token: data.accessToken,
      expiresAt: Date.now() + 3600_000,
    });
    return data.accessToken;
  }

  async testConnection(
    config: Connector['config'],
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const cfg = this.getConfig(config);
      const token = await this.authenticate(cfg);
      const url = cfg.workspaceId
        ? `${cfg.apiUrl}/api/v1/workspaces/${cfg.workspaceId}/projects`
        : `${cfg.apiUrl}/api/v1/workspaces`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return {
        success: response.ok,
        error: response.ok ? undefined : `HTTP ${response.status}`,
      };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  }

  async listRemoteProjects(
    config: Connector['config'],
  ): Promise<{ id: string; name: string }[]> {
    const cfg = this.getConfig(config);
    const token = await this.authenticate(cfg);
    if (!cfg.workspaceId) return [];

    const response = await fetch(
      `${cfg.apiUrl}/api/v1/workspaces/${cfg.workspaceId}/projects`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) return [];

    const data = await response.json();
    const projects = Array.isArray(data) ? data : (data as any).data ?? [];
    return projects.map((p: any) => ({ id: p.id, name: p.name }));
  }

  async pushEpic(input: PushEpicInput, config: Connector['config']): Promise<PushEpicResult> {
    const cfg = this.getConfig(config);
    try {
      const token = await this.authenticate(cfg);
      const statusMapping = input.statusMappings.find(
        (m) => m.devchainStatusLabel === (input.epic as any).statusName,
      );
      const externalStatus = statusMapping?.externalStatusId ?? undefined;

      const taskBody: Record<string, unknown> = {
        title: input.epic.title,
        description: input.epic.description ?? '',
      };
      if (externalStatus) taskBody.status = externalStatus;
      if (input.epic.parentId) taskBody.parentId = input.epic.parentId;

      if (!input.syncState.externalId) {
        const response = await fetch(
          `${cfg.apiUrl}/api/v1/workspaces/${cfg.workspaceId}/projects/${cfg.externalProjectId}/tasks`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(taskBody),
          },
        );
        if (!response.ok) {
          const error = await response.text();
          return { externalId: '', success: false, error };
        }
        const created = (await response.json()) as { id: string };
        return { externalId: created.id, success: true };
      } else {
        const response = await fetch(
          `${cfg.apiUrl}/api/v1/workspaces/${cfg.workspaceId}/projects/${cfg.externalProjectId}/tasks/${input.syncState.externalId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(taskBody),
          },
        );
        if (!response.ok) {
          const error = await response.text();
          return { externalId: input.syncState.externalId, success: false, error };
        }
        return { externalId: input.syncState.externalId, success: true };
      }
    } catch (e) {
      logger.error({ error: e }, 'Taskim pushEpic failed');
      return {
        externalId: input.syncState.externalId ?? '',
        success: false,
        error: e instanceof Error ? e.message : 'Unknown',
      };
    }
  }

  async pullEpic(
    externalId: string,
    config: Connector['config'],
  ): Promise<NormalizedExternalTask | null> {
    const cfg = this.getConfig(config);
    try {
      const token = await this.authenticate(cfg);
      const response = await fetch(
        `${cfg.apiUrl}/api/v1/workspaces/${cfg.workspaceId}/projects/${cfg.externalProjectId}/tasks/${externalId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) return null;
      const task = (await response.json()) as any;
      return {
        externalId: task.id,
        title: task.title,
        description: task.description ?? null,
        statusId: task.status ?? null,
        tags: task.labels ?? [],
        parentId: task.parentId ?? null,
        assigneeName: null,
        updatedAt: task.updatedAt ?? new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  async pushComment(input: PushCommentInput, config: Connector['config']): Promise<void> {
    const cfg = this.getConfig(config);
    const token = await this.authenticate(cfg);
    await fetch(
      `${cfg.apiUrl}/api/v1/workspaces/${cfg.workspaceId}/projects/${cfg.externalProjectId}/tasks/${input.epicExternalId}/comments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          content: `[${input.authorName} via DevChain] ${input.content}`,
        }),
      },
    );
  }

  async resolveWebhook(
    payload: unknown,
    _config: Connector['config'],
  ): Promise<InboundEvent | null> {
    const data = payload as Record<string, unknown>;
    if (!data || typeof data !== 'object') return null;

    const type = data.type as string | undefined;
    const task = (data.task ?? data.payload ?? data) as Record<string, unknown>;

    const actionMap: Record<string, InboundEvent['action']> = {
      'task.created': 'created',
      'task.updated': 'updated',
      'task.deleted': 'deleted',
      'comment.created': 'comment_created',
    };

    const action = actionMap[type ?? ''] ?? 'updated';
    const externalId = (task.id ?? data.id ?? '') as string;
    if (!externalId) return null;

    return {
      action,
      externalId: String(externalId),
      fields:
        action === 'deleted'
          ? undefined
          : {
              externalId: String(externalId),
              title: (task.title as string) ?? '',
              description: (task.description as string) ?? null,
              statusId: (task.status as string) ?? null,
              tags: (task.labels as string[]) ?? [],
              parentId: (task.parentId as string) ?? null,
              assigneeName: null,
              updatedAt: (task.updatedAt as string) ?? new Date().toISOString(),
            },
      timestamp: (data.timestamp as string) ?? new Date().toISOString(),
    };
  }
}
