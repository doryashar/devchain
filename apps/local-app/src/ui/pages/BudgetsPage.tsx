import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSelectedProject } from '../hooks/useProjectSelection';
import { useToast } from '../hooks/use-toast';
import { PageHeader, EmptyState, ConfirmDialog } from '../components/shared';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Switch } from '../components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { Skeleton } from '../components/ui/skeleton';
import {
  budgetsQueryKeys,
  fetchBudgets,
  createBudget,
  updateBudget,
  deleteBudget,
  toggleBudget,
  formatUsd,
  periodLabel,
  actionLabel,
  type CreateBudgetPayload,
} from '../lib/budgets';
import { DollarSign, Plus, Trash2, Pencil, Loader2, AlertTriangle } from 'lucide-react';

interface BudgetFormData {
  scope: 'project' | 'global';
  name: string;
  description: string;
  limitUsd: string;
  period: 'daily' | 'weekly' | 'monthly' | 'lifetime';
  action: 'notify' | 'block' | 'kill';
  thresholdPercent: string;
}

const defaultForm: BudgetFormData = {
  scope: 'project',
  name: '',
  description: '',
  limitUsd: '100',
  period: 'monthly',
  action: 'notify',
  thresholdPercent: '80',
};

export function BudgetsPage() {
  const { selectedProjectId } = useSelectedProject();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BudgetFormData>(defaultForm);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: budgets, isLoading } = useQuery({
    queryKey: budgetsQueryKeys.budgets(selectedProjectId ?? undefined),
    queryFn: () => fetchBudgets(undefined, selectedProjectId),
    enabled: !!selectedProjectId,
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateBudgetPayload) => createBudget(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: budgetsQueryKeys.budgets(selectedProjectId ?? undefined) });
      closeDialog();
      toast({ title: 'Budget created' });
    },
    onError: (err: Error) => toast({ title: 'Failed to create budget', description: err.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteBudget(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: budgetsQueryKeys.budgets(selectedProjectId ?? undefined) });
      setDeleteId(null);
      toast({ title: 'Budget deleted' });
    },
    onError: (err: Error) => toast({ title: 'Failed to delete budget', description: err.message, variant: 'destructive' }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => toggleBudget(id, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: budgetsQueryKeys.budgets(selectedProjectId ?? undefined) });
    },
    onError: (err: Error) => toast({ title: 'Failed to toggle budget', description: err.message, variant: 'destructive' }),
  });

  function openCreate() {
    setEditingId(null);
    setForm(defaultForm);
    setDialogOpen(true);
  }

  function openEdit(budget: typeof budgets extends (infer T)[] | undefined ? T : never) {
    if (!budget) return;
    setEditingId(budget.id);
    setForm({
      scope: budget.scope as BudgetFormData['scope'],
      name: budget.name,
      description: budget.description ?? '',
      limitUsd: String(budget.limitUsd),
      period: budget.period as BudgetFormData['period'],
      action: budget.action as BudgetFormData['action'],
      thresholdPercent: String(budget.thresholdPercent),
    });
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingId(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const limit = parseFloat(form.limitUsd);
    const threshold = parseInt(form.thresholdPercent, 10);
    if (!form.name || isNaN(limit) || limit <= 0) return;

    if (editingId) {
      updateBudget(editingId, {
        name: form.name,
        description: form.description || null,
        limitUsd: limit,
        period: form.period,
        action: form.action,
        thresholdPercent: threshold,
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: budgetsQueryKeys.budgets(selectedProjectId ?? undefined) });
        closeDialog();
        toast({ title: 'Budget updated' });
      }).catch((err: Error) => {
        toast({ title: 'Failed to update budget', description: err.message, variant: 'destructive' });
      });
    } else {
      createMutation.mutate({
        scope: form.scope,
        projectId: form.scope === 'project' ? selectedProjectId : undefined,
        name: form.name,
        description: form.description || null,
        limitUsd: limit,
        period: form.period,
        action: form.action,
        thresholdPercent: threshold,
      });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Budgets"
        description="Manage spending limits and cost controls for your agents."
        actions={
          <Button onClick={openCreate} disabled={!selectedProjectId}>
            <Plus className="mr-2 h-4 w-4" />
            Add Budget
          </Button>
        }
      />

      {isLoading && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && (!budgets || budgets.length === 0) && (
        <EmptyState
          icon={DollarSign}
          title="No budgets configured"
          description="Create a budget to set spending limits and receive alerts when costs approach or exceed your thresholds."
          action={
            <Button onClick={openCreate} disabled={!selectedProjectId}>
              <Plus className="mr-2 h-4 w-4" />
              Add Budget
            </Button>
          }
        />
      )}

      {!isLoading && budgets && budgets.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {budgets.map((budget) => (
            <BudgetCard
              key={budget.id}
              budget={budget}
              onToggle={(enabled) => toggleMutation.mutate({ id: budget.id, enabled })}
              onEdit={() => openEdit(budget)}
              onDelete={() => setDeleteId(budget.id)}
              isToggling={toggleMutation.isPending}
            />
          ))}
        </div>
      )}

      <BudgetFormDialog
        open={dialogOpen}
        editing={!!editingId}
        form={form}
        setForm={setForm}
        onSubmit={handleSubmit}
        onClose={closeDialog}
        isSubmitting={createMutation.isPending}
        projectId={selectedProjectId}
      />

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null); }}
        title="Delete Budget"
        description="Are you sure you want to delete this budget? This action cannot be undone."
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => { if (deleteId) deleteMutation.mutate(deleteId); }}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

function BudgetCard({
  budget,
  onToggle,
  onEdit,
  onDelete,
  isToggling,
}: {
  budget: {
    id: string;
    scope: string;
    name: string;
    enabled: boolean;
    limitUsd: number;
    currentSpendUsd: number;
    percentUsed: number;
    remainingUsd: number;
    period: string;
    action: string;
    thresholdPercent: number;
  };
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  isToggling: boolean;
}) {
  const isExceeded = budget.percentUsed >= 100;
  const isThreshold = budget.percentUsed >= budget.thresholdPercent;

  return (
    <Card className={!budget.enabled ? 'opacity-60' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{budget.name}</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={budget.scope === 'global' ? 'default' : 'secondary'}>
              {budget.scope === 'global' ? 'Global' : 'Project'}
            </Badge>
            <Switch
              checked={budget.enabled}
              onCheckedChange={onToggle}
              disabled={isToggling}
              aria-label={`Toggle ${budget.name}`}
            />
          </div>
        </div>
        <CardDescription>
          {periodLabel(budget.period)} &middot; {actionLabel(budget.action)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Spent</span>
          <span className={isExceeded ? 'text-destructive font-semibold' : ''}>
            {formatUsd(budget.currentSpendUsd)}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Limit</span>
          <span>{formatUsd(budget.limitUsd)}</span>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{budget.percentUsed.toFixed(0)}% used</span>
            <span>{formatUsd(budget.remainingUsd)} remaining</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                isExceeded
                  ? 'bg-destructive'
                  : isThreshold
                    ? 'bg-yellow-500'
                    : 'bg-primary'
              }`}
              style={{ width: `${Math.min(budget.percentUsed, 100)}%` }}
            />
          </div>
        </div>

        {isThreshold && !isExceeded && (
          <div className="flex items-center gap-1.5 text-xs text-yellow-600 dark:text-yellow-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>Threshold ({budget.thresholdPercent}%) exceeded</span>
          </div>
        )}
        {isExceeded && (
          <div className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>Budget limit exceeded</span>
          </div>
        )}

        <div className="flex justify-end gap-1 pt-2">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function BudgetFormDialog({
  open,
  editing,
  form,
  setForm,
  onSubmit,
  onClose,
  isSubmitting,
  projectId,
}: {
  open: boolean;
  editing: boolean;
  form: BudgetFormData;
  setForm: (form: BudgetFormData) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  isSubmitting: boolean;
  projectId: string | null | undefined;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Budget' : 'Create Budget'}</DialogTitle>
          <DialogDescription>
            {editing ? 'Update budget settings.' : 'Set a spending limit for your agents.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          {!editing && (
            <div className="space-y-2">
              <Label>Scope</Label>
              <Select
                value={form.scope}
                onValueChange={(v) => setForm({ ...form, scope: v as BudgetFormData['scope'] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="project">Project</SelectItem>
                  <SelectItem value="global">Global</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="budget-name">Name</Label>
            <Input
              id="budget-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Monthly spending limit"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="budget-description">Description</Label>
            <Textarea
              id="budget-description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Optional description"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="budget-limit">Limit (USD)</Label>
              <Input
                id="budget-limit"
                type="number"
                step="0.01"
                min="0.01"
                value={form.limitUsd}
                onChange={(e) => setForm({ ...form, limitUsd: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Period</Label>
              <Select
                value={form.period}
                onValueChange={(v) => setForm({ ...form, period: v as BudgetFormData['period'] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="lifetime">Lifetime</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Action</Label>
              <Select
                value={form.action}
                onValueChange={(v) => setForm({ ...form, action: v as BudgetFormData['action'] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="notify">Notify Only</SelectItem>
                  <SelectItem value="block">Block Sessions</SelectItem>
                  <SelectItem value="kill">Kill Sessions</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="budget-threshold">Threshold %</Label>
              <Input
                id="budget-threshold"
                type="number"
                min="1"
                max="100"
                value={form.thresholdPercent}
                onChange={(e) => setForm({ ...form, thresholdPercent: e.target.value })}
              />
            </div>
          </div>

          {form.scope === 'project' && !editing && !projectId && (
            <p className="text-sm text-destructive">Select a project first to create a project-scoped budget.</p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || (!editing && form.scope === 'project' && !projectId)}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
