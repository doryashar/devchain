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
    const cacheKey = `${config.apiUrl}:${config.credentials.token ?? ''}`;
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }
    const token = config.credentials.token;
    if (!token) {
      throw new Error('Taskim adapter requires credentials.token (API key)');
    }
    this.tokenCache.set(cacheKey, { token, expiresAt: Date.now() + 3600_000 });
    return token;
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

  async listWorkspaces(config: Connector['config']): Promise<{ id: string; name: string }[]> {
    const cfg = this.getConfig(config);
    const token = await this.authenticate(cfg);
    const response = await fetch(`${cfg.apiUrl}/api/v1/workspaces`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return [];
    const data: unknown = await response.json();
    const list = Array.isArray(data)
      ? data
      : Array.isArray((data as { data?: unknown[] }).data)
        ? (data as { data: unknown[] }).data
        : [];
    return list.map((w) => ({
      id: (w as { id: string }).id,
      name: (w as { name: string }).name,
    }));
  }

  async listProjects(
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

  async createWorkspace(
    config: Connector['config'],
    name: string,
  ): Promise<{ id: string; name: string }> {
    const cfg = this.getConfig(config);
    const token = await this.authenticate(cfg);
    const response = await fetch(`${cfg.apiUrl}/api/v1/workspaces`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      throw new Error(`Failed to create Taskim workspace: HTTP ${response.status}`);
    }
    const created: unknown = await response.json();
    const ws = Array.isArray(created) ? created[0] : created;
    return {
      id: (ws as { id: string }).id,
      name: (ws as { name: string }).name,
    };
  }

  async createProject(
    config: Connector['config'],
    name: string,
  ): Promise<{ id: string; name: string }> {
    const cfg = this.getConfig(config);
    if (!cfg.workspaceId) {
      throw new Error('Cannot create a Taskim project without a workspaceId');
    }
    const token = await this.authenticate(cfg);
    const response = await fetch(`${cfg.apiUrl}/api/v1/workspaces/${cfg.workspaceId}/projects`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      throw new Error(`Failed to create Taskim project: HTTP ${response.status}`);
    }
    const created: unknown = await response.json();
    const proj = Array.isArray(created) ? created[0] : created;
    return {
      id: (proj as { id: string }).id,
      name: (proj as { name: string }).name,
    };
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
