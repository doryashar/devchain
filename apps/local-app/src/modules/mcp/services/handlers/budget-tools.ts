import type { McpToolContext } from './types';
import type { McpResponse, SessionContext } from '../../dtos/mcp.dto';

function missingSessionResolver(): McpResponse {
  return {
    success: false,
    error: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Session resolution requires full app context (not available in standalone MCP mode)',
    },
  };
}

async function resolveProjectId(
  ctx: McpToolContext,
  sessionId: string,
): Promise<{ projectId: string } | McpResponse> {
  if (!ctx.resolveSessionContext) return missingSessionResolver();

  const result = await ctx.resolveSessionContext(sessionId);
  if (!result.success) return result;

  const { project } = result.data as SessionContext;
  if (!project) {
    return {
      success: false,
      error: { code: 'PROJECT_NOT_FOUND', message: 'No project associated with this session' },
    };
  }

  return { projectId: project.id };
}

export async function handleGetBudget(
  ctx: McpToolContext,
  params: unknown,
): Promise<McpResponse> {
  const { sessionId } = params as { sessionId: string };
  const projectResult = await resolveProjectId(ctx, sessionId);
  if ('error' in projectResult && !('projectId' in projectResult)) return projectResult as McpResponse;
  const { projectId } = projectResult as { projectId: string };

  const projectBudgets = await ctx.storage.listEnabledBudgetsByProject(projectId);
  const globalBudgets = await ctx.storage.listEnabledGlobalBudgets();

  const allBudgets = [...projectBudgets, ...globalBudgets];
  if (allBudgets.length === 0) {
    return {
      success: true,
      data: { budgets: [], message: 'No active budgets for this project' },
    };
  }

  const budgets = allBudgets.map((b) => {
    const pct = b.limitUsd > 0 ? (b.currentSpendUsd / b.limitUsd) * 100 : 0;
    return {
      name: b.name,
      scope: b.scope,
      period: b.period,
      spendUsd: Math.round(b.currentSpendUsd * 100) / 100,
      limitUsd: b.limitUsd,
      remainingUsd: Math.round(Math.max(0, b.limitUsd - b.currentSpendUsd) * 100) / 100,
      percentUsed: Math.round(pct * 10) / 10,
      action: b.action,
      thresholdPercent: b.thresholdPercent,
    };
  });

  return { success: true, data: { budgets } };
}

export async function handleGetSpend(
  ctx: McpToolContext,
  params: unknown,
): Promise<McpResponse> {
  const { sessionId } = params as { sessionId: string };
  const projectResult = await resolveProjectId(ctx, sessionId);
  if ('error' in projectResult && !('projectId' in projectResult)) return projectResult as McpResponse;
  const { projectId } = projectResult as { projectId: string };

  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const totalSpend = await ctx.storage.getProjectSpend(projectId, since);

  return {
    success: true,
    data: {
      projectId,
      totalSpendUsd: Math.round(totalSpend * 100) / 100,
      period: 'monthly',
      since,
    },
  };
}
