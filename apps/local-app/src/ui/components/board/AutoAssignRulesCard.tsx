import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { Switch } from '@/ui/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/components/ui/select';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { useToast } from '@/ui/hooks/use-toast';

interface Rule {
  id: string;
  projectId: string;
  matchType: 'status' | 'tag';
  statusId: string | null;
  tags: string[] | null;
  targetType: 'agent' | 'team';
  targetAgentId: string | null;
  targetTeamId: string | null;
  overrideExisting: boolean;
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
interface Status {
  id: string;
  label: string;
  color: string;
}
interface Agent {
  id: string;
  name: string;
}
interface TeamLite {
  id: string;
  name: string;
  teamLeadAgentName: string | null;
}

async function getJSON(res: Response, fallback: string) {
  if (!res.ok) {
    const e = await res.json().catch(() => ({ message: fallback }));
    throw new Error(e.message || fallback);
  }
  return res.json();
}

export function AutoAssignRulesCard({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);

  const { data: rules = [] } = useQuery<Rule[]>({
    queryKey: ['auto-assign-rules', projectId],
    queryFn: async () =>
      getJSON(await fetch(`/api/auto-assign-rules?projectId=${projectId}`), 'Failed to load rules'),
    enabled: !!projectId,
  });
  const { data: statuses = [] } = useQuery<Status[]>({
    queryKey: ['statuses', projectId],
    queryFn: async () =>
      (
        await getJSON(
          await fetch(`/api/statuses?projectId=${projectId}`),
          'Failed to load statuses',
        )
      ).items,
  });
  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ['agents', projectId],
    queryFn: async () =>
      (await getJSON(await fetch(`/api/agents?projectId=${projectId}`), 'Failed to load agents'))
        .items,
  });
  const { data: teams = [] } = useQuery<TeamLite[]>({
    queryKey: ['teams', projectId],
    queryFn: async () =>
      (await getJSON(await fetch(`/api/teams?projectId=${projectId}`), 'Failed to load teams'))
        .items,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['auto-assign-rules', projectId] });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/auto-assign-rules/${id}`, { method: 'DELETE' });
      await getJSON(r, 'Failed to delete rule');
    },
    onSuccess: invalidate,
    onError: (e) =>
      toast({
        title: 'Error',
        description: e instanceof Error ? e.message : 'Failed to delete rule',
        variant: 'destructive',
      }),
  });
  const toggle = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const r = await fetch(`/api/auto-assign-rules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      await getJSON(r, 'Failed to update rule');
    },
    onSuccess: invalidate,
    onError: (e) =>
      toast({
        title: 'Error',
        description: e instanceof Error ? e.message : 'Failed to update rule',
        variant: 'destructive',
      }),
  });

  const statusLabel = (id: string | null) => statuses.find((s) => s.id === id)?.label ?? null;
  const teamName = (id: string | null) => teams.find((t) => t.id === id);
  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name ?? null;
  const isStale = (r: Rule) =>
    (r.matchType === 'status' && !!r.statusId && !statusLabel(r.statusId)) ||
    (r.targetType === 'agent' && !!r.targetAgentId && !agentName(r.targetAgentId)) ||
    (r.targetType === 'team' && !!r.targetTeamId && !teamName(r.targetTeamId));

  return (
    <Card id="auto-assign" className="mt-6">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Auto-assign rules</CardTitle>
          <CardDescription>
            Automatically assign epics when they're created or move to a status. Rules skip on
            auto-clean statuses. First matching rule wins.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus className="h-4 w-4 mr-1.5" /> Add rule
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {rules.length === 0 && <p className="text-sm text-muted-foreground">No rules yet.</p>}
        {rules.map((r) => (
          <div key={r.id} className="flex items-center gap-2 p-3 border rounded-md">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
            {r.matchType === 'status' ? (
              <Badge variant="secondary">Status · {statusLabel(r.statusId) ?? '—'}</Badge>
            ) : (
              <Badge variant="secondary">Tag · {(r.tags ?? []).join(', ')}</Badge>
            )}
            <span className="text-muted-foreground">→</span>
            {r.targetType === 'agent' ? (
              <span className="text-sm">{agentName(r.targetAgentId) ?? 'Unknown agent'}</span>
            ) : (
              <span className="text-sm">
                👥 {teamName(r.targetTeamId)?.name ?? 'Unknown team'}
                {teamName(r.targetTeamId)?.teamLeadAgentName
                  ? ` (lead: ${teamName(r.targetTeamId)!.teamLeadAgentName})`
                  : ''}
              </span>
            )}
            {r.overrideExisting && <Badge variant="outline">override</Badge>}
            {isStale(r) && <Badge variant="destructive">invalid</Badge>}
            <div className="ml-auto flex items-center gap-2">
              <Switch
                checked={r.enabled}
                onCheckedChange={(v) => toggle.mutate({ id: r.id, enabled: v })}
                aria-label="Toggle rule"
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete rule"
                onClick={() => del.mutate(r.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
        {showForm && (
          <AutoAssignRuleForm
            projectId={projectId}
            statuses={statuses}
            agents={agents}
            teams={teams}
            onSaved={() => {
              setShowForm(false);
              invalidate();
            }}
            onCancel={() => setShowForm(false)}
          />
        )}
      </CardContent>
    </Card>
  );
}

function AutoAssignRuleForm({
  projectId,
  statuses,
  agents,
  teams,
  onSaved,
  onCancel,
}: {
  projectId: string;
  statuses: Status[];
  agents: Agent[];
  teams: TeamLite[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [matchType, setMatchType] = useState<'status' | 'tag'>('status');
  const [statusId, setStatusId] = useState<string>(statuses[0]?.id ?? '');
  const [tags, setTags] = useState<string>('');
  const [targetType, setTargetType] = useState<'agent' | 'team'>('agent');
  const [targetAgentId, setTargetAgentId] = useState<string>(agents[0]?.id ?? '');
  const [targetTeamId, setTargetTeamId] = useState<string>(teams[0]?.id ?? '');
  const [overrideExisting, setOverrideExisting] = useState(false);

  const m = useMutation({
    mutationFn: async () => {
      const body = {
        matchType,
        statusId: matchType === 'status' ? statusId : null,
        tags:
          matchType === 'tag'
            ? tags
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean)
            : null,
        targetType,
        targetAgentId: targetType === 'agent' ? targetAgentId : null,
        targetTeamId: targetType === 'team' ? targetTeamId : null,
        overrideExisting,
        enabled: true,
      };
      const r = await fetch(`/api/auto-assign-rules?projectId=${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await getJSON(r, 'Failed to create rule');
    },
    onSuccess: onSaved,
    onError: (e) =>
      toast({
        title: 'Error',
        description: e instanceof Error ? e.message : 'Failed to create rule',
        variant: 'destructive',
      }),
  });

  return (
    <div className="p-3 border rounded-md space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Match by</Label>
          <Select value={matchType} onValueChange={(v) => setMatchType(v as 'status' | 'tag')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="status">Status (column)</SelectItem>
              <SelectItem value="tag">Tag (label)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {matchType === 'status' ? (
          <div>
            <Label>Status</Label>
            <Select value={statusId} onValueChange={setStatusId}>
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div>
            <Label>Tags (comma-separated; matches any)</Label>
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="frontend, ui"
            />
          </div>
        )}
        <div>
          <Label>Assign to</Label>
          <Select value={targetType} onValueChange={(v) => setTargetType(v as 'agent' | 'team')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="agent">Agent</SelectItem>
              <SelectItem value="team">Team (lead)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {targetType === 'agent' ? (
          <div>
            <Label>Agent</Label>
            <Select value={targetAgentId} onValueChange={setTargetAgentId}>
              <SelectTrigger>
                <SelectValue placeholder="Select agent" />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div>
            <Label>Team</Label>
            <Select value={targetTeamId} onValueChange={setTargetTeamId}>
              <SelectTrigger>
                <SelectValue placeholder="Select team" />
              </SelectTrigger>
              <SelectContent>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={overrideExisting} onCheckedChange={setOverrideExisting} />
        Override existing assignment
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => m.mutate()} disabled={m.isPending}>
          Save rule
        </Button>
      </div>
    </div>
  );
}
