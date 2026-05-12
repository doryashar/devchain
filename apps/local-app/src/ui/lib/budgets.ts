import { fetchJsonOrThrow, fetchOrThrow } from '@/ui/lib/sessions';

export interface BudgetDto {
  id: string;
  scope: string;
  projectId: string | null;
  name: string;
  description: string | null;
  enabled: boolean;
  limitUsd: number;
  period: string;
  periodStartDate: string | null;
  action: string;
  thresholdPercent: number;
  currentSpendUsd: number;
  spendWindowStart: string | null;
  lastEvaluatedAt: string | null;
  percentUsed: number;
  remainingUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface SpendRecordDto {
  id: string;
  budgetId: string;
  sessionId: string | null;
  projectId: string;
  agentId: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number;
  periodStart: string;
  recordedAt: string;
}

export interface CreateBudgetPayload {
  scope: 'project' | 'global';
  projectId?: string | null;
  name: string;
  description?: string | null;
  enabled?: boolean;
  limitUsd: number;
  period: 'daily' | 'weekly' | 'monthly' | 'lifetime';
  periodStartDate?: string | null;
  action?: 'notify' | 'block' | 'kill';
  thresholdPercent?: number;
}

export interface UpdateBudgetPayload {
  name?: string;
  description?: string | null;
  enabled?: boolean;
  limitUsd?: number;
  period?: 'daily' | 'weekly' | 'monthly' | 'lifetime';
  periodStartDate?: string | null;
  action?: 'notify' | 'block' | 'kill';
  thresholdPercent?: number;
}

export const budgetsQueryKeys = {
  budgets: (projectId?: string) => ['budgets', projectId ?? 'all'] as const,
  budget: (id: string) => ['budgets', id] as const,
  spend: (id: string) => ['budgets', id, 'spend'] as const,
};

export async function fetchBudgets(scope?: string, projectId?: string): Promise<BudgetDto[]> {
  const params = new URLSearchParams();
  if (scope) params.set('scope', scope);
  if (projectId) params.set('projectId', projectId);
  const qs = params.toString();
  return fetchJsonOrThrow<BudgetDto[]>(`/api/budgets${qs ? `?${qs}` : ''}`);
}

export async function fetchBudget(id: string): Promise<BudgetDto> {
  return fetchJsonOrThrow<BudgetDto>(`/api/budgets/${encodeURIComponent(id)}`);
}

export async function createBudget(data: CreateBudgetPayload): Promise<BudgetDto> {
  return fetchJsonOrThrow<BudgetDto>('/api/budgets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function updateBudget(id: string, data: UpdateBudgetPayload): Promise<BudgetDto> {
  return fetchJsonOrThrow<BudgetDto>(`/api/budgets/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deleteBudget(id: string): Promise<void> {
  await fetchOrThrow(`/api/budgets/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function toggleBudget(id: string, enabled: boolean): Promise<BudgetDto> {
  return fetchJsonOrThrow<BudgetDto>(`/api/budgets/${encodeURIComponent(id)}/toggle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}

export async function fetchSpendRecords(budgetId: string, periodStart?: string): Promise<SpendRecordDto[]> {
  const params = new URLSearchParams();
  if (periodStart) params.set('periodStart', periodStart);
  const qs = params.toString();
  return fetchJsonOrThrow<SpendRecordDto[]>(`/api/budgets/${encodeURIComponent(budgetId)}/spend${qs ? `?${qs}` : ''}`);
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function periodLabel(period: string): string {
  const labels: Record<string, string> = {
    daily: 'Daily',
    weekly: 'Weekly',
    monthly: 'Monthly',
    lifetime: 'Lifetime',
  };
  return labels[period] ?? period;
}

export function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    notify: 'Notify Only',
    block: 'Block New Sessions',
    kill: 'Kill Running Sessions',
  };
  return labels[action] ?? action;
}
