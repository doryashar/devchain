import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSelectedProject } from '../hooks/useProjectSelection';
import { useToast } from '../hooks/use-toast';
import {
  fetchConnectors,
  createConnector,
  updateConnector,
  deleteConnector,
  type Connector,
} from '../lib/connectors';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Badge } from '../components/ui/badge';
import { Card, CardContent } from '../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Plug, Plus, Trash2, Loader2 } from 'lucide-react';

export function ConnectorsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { selectedProjectId } = useSelectedProject();
  const [showCreate, setShowCreate] = useState(false);

  const { data: connectors, isLoading } = useQuery({
    queryKey: ['connectors', selectedProjectId],
    queryFn: () => fetchConnectors(selectedProjectId as string),
    enabled: !!selectedProjectId,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateConnector(id, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors', selectedProjectId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteConnector,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors', selectedProjectId] });
      toast({ title: 'Connector deleted' });
    },
  });

  return (
    <div className="container py-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Plug className="w-6 h-6" />
          <h1 className="text-2xl font-bold">Connectors</h1>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Add Connector
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : !connectors || connectors.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No connectors configured. Click "Add Connector" to sync with an external
            service.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {connectors.map((connector) => (
            <ConnectorCard
              key={connector.id}
              connector={connector}
              onToggle={(enabled) =>
                toggleMutation.mutate({ id: connector.id, enabled })
              }
              onDelete={() => deleteMutation.mutate(connector.id)}
            />
          ))}
        </div>
      )}

      {showCreate && selectedProjectId && (
        <CreateConnectorDialog
          projectId={selectedProjectId}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({
              queryKey: ['connectors', selectedProjectId],
            });
          }}
        />
      )}
    </div>
  );
}

function ConnectorCard({
  connector,
  onToggle,
  onDelete,
}: {
  connector: Connector;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-semibold">{connector.name}</h4>
              <Badge variant={connector.enabled ? 'default' : 'secondary'}>
                {connector.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
              <Badge variant="outline" className="capitalize">
                {connector.type}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              API: {connector.config.apiUrl}
              {connector.externalProjectId
                ? ` · Project: ${connector.externalProjectId}`
                : ''}
            </p>
          </div>
          <div className="flex items-center gap-3 ml-4">
            <Switch checked={connector.enabled} onCheckedChange={onToggle} />
            <Button variant="ghost" size="icon" onClick={onDelete}>
              <Trash2 className="w-4 h-4 text-destructive" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateConnectorDialog({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [type, setType] = useState<'taskim' | 'monday' | 'jira'>('taskim');
  const [name, setName] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [externalProjectId, setExternalProjectId] = useState('');

  const createMutation = useMutation({
    mutationFn: () =>
      createConnector({
        projectId,
        type,
        name,
        enabled: false,
        config: {
          apiUrl,
          credentials: type === 'taskim' ? { email, password } : {},
          workspaceId: workspaceId || undefined,
        },
        externalProjectId: externalProjectId || null,
      }),
    onSuccess: () => {
      toast({ title: 'Connector created' });
      onCreated();
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'Failed to create connector',
        variant: 'destructive',
      });
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Connector</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as any)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="taskim">Taskim</SelectItem>
                <SelectItem value="monday">Monday (coming soon)</SelectItem>
                <SelectItem value="jira">Jira (coming soon)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Taskim"
            />
          </div>
          <div className="space-y-2">
            <Label>API URL</Label>
            <Input
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="http://localhost:3000"
            />
          </div>
          {type === 'taskim' && (
            <>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="demo@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Workspace ID</Label>
                <Input
                  value={workspaceId}
                  onChange={(e) => setWorkspaceId(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>External Project ID</Label>
                <Input
                  value={externalProjectId}
                  onChange={(e) => setExternalProjectId(e.target.value)}
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !name || !apiUrl}
          >
            {createMutation.isPending ? 'Creating...' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
