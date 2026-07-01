import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Textarea } from '@/ui/components/ui/textarea';
import { Badge } from '@/ui/components/ui/badge';
import { X, Plus, Tag as TagIcon, Maximize2, Minimize2, Trash2 } from 'lucide-react';
import { useSelectedProject } from '@/ui/hooks/useProjectSelection';
import { useToast } from '@/ui/hooks/use-toast';
import { OptimisticLockError } from '@/common/errors/error-types';
import { PageHeader, EmptyState, ConfirmDialog } from '@/ui/components/shared';

interface PromptSummary {
  id: string;
  projectId: string | null;
  title: string;
  contentPreview: string;
  version: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface PromptDetail extends PromptSummary {
  content: string;
}

export interface PromptsQueryData {
  items: PromptSummary[];
  total?: number;
  limit?: number;
  offset?: number;
}

export const PROMPT_VARIABLES = [
  { token: '{agent_name}', description: 'Current agent name' },
  { token: '{project_name}', description: 'Selected project name' },
  { token: '{epic_title}', description: 'Epic title (empty when no epic)' },
  { token: '{provider_name}', description: 'Provider name (e.g., claude, codex)' },
  { token: '{profile_name}', description: 'Agent profile name' },
  { token: '{session_id}', description: 'Session UUID at launch' },
  { token: '{session_id_short}', description: '8-char session ID prefix for MCP tools' },
];

async function fetchPrompts(projectId: string): Promise<PromptsQueryData> {
  const res = await fetch(`/api/prompts?projectId=${encodeURIComponent(projectId)}`);
  if (!res.ok) throw new Error('Failed to fetch prompts');
  return res.json();
}

export async function createPrompt(data: {
  projectId: string;
  title: string;
  content: string;
  tags?: string[];
}) {
  const res = await fetch('/api/prompts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create prompt');
  return res.json();
}

export async function deletePrompt(id: string) {
  const res = await fetch(`/api/prompts/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete prompt');
}

async function fetchPromptDetail(id: string): Promise<PromptDetail> {
  const res = await fetch(`/api/prompts/${id}`);
  if (!res.ok) throw new Error('Failed to fetch prompt');
  return res.json();
}

async function updatePromptVersioned(
  id: string,
  data: Partial<PromptDetail>,
  version: number,
): Promise<PromptDetail> {
  const res = await fetch(`/api/prompts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, version }),
  });
  if (res.status === 409) throw new OptimisticLockError('Prompt', id);
  if (!res.ok) throw new Error('Failed to update prompt');
  return res.json();
}

// Markdown Preview Component
export function MarkdownPreview({ content }: { content: string }) {
  // Simple markdown-like rendering
  const renderContent = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, idx) => {
      if (line.startsWith('# ')) {
        return (
          <h1 key={idx} className="text-2xl font-bold mb-2">
            {line.substring(2)}
          </h1>
        );
      }
      if (line.startsWith('## ')) {
        return (
          <h2 key={idx} className="text-xl font-semibold mb-2">
            {line.substring(3)}
          </h2>
        );
      }
      if (line.startsWith('### ')) {
        return (
          <h3 key={idx} className="text-lg font-semibold mb-1">
            {line.substring(4)}
          </h3>
        );
      }
      if (line.startsWith('- ')) {
        return (
          <li key={idx} className="ml-4">
            {line.substring(2)}
          </li>
        );
      }
      if (line.trim() === '') {
        return <div key={idx} className="h-2" />;
      }
      return (
        <p key={idx} className="mb-2">
          {line}
        </p>
      );
    });
  };

  return (
    <div className="prose prose-sm max-w-none dark:prose-invert">{renderContent(content)}</div>
  );
}

// Tag Input Component with Autocomplete
export function TagInput({
  tags,
  suggestions,
  onAddTag,
  onRemoveTag,
  onInputChange,
}: {
  tags: string[];
  suggestions: string[];
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onInputChange?: (value: string) => void;
}) {
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const filteredSuggestions = useMemo(() => {
    if (!input) return [];
    return suggestions
      .filter((s) => s.toLowerCase().includes(input.toLowerCase()) && !tags.includes(s))
      .slice(0, 5);
  }, [input, suggestions, tags]);

  const handleAddTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onAddTag(trimmed);
      setInput('');
      setShowSuggestions(false);
      onInputChange?.('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleAddTag(input);
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      onRemoveTag(tags[tags.length - 1]);
    }
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    onInputChange?.(value);
  };

  return (
    <div className="relative">
      <div className="flex flex-wrap gap-2 p-2 border rounded-md min-h-[42px] items-center bg-background">
        {tags.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1">
            <TagIcon className="h-3 w-3" />
            {tag}
            <button
              type="button"
              onClick={() => onRemoveTag(tag)}
              className="ml-1 hover:bg-muted rounded-full"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => {
            handleInputChange(e.target.value);
            setShowSuggestions(true);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          placeholder={tags.length === 0 ? 'Add tags (label or key:value)...' : ''}
          className="flex-1 min-w-[120px] outline-none bg-transparent"
        />
      </div>
      {showSuggestions && filteredSuggestions.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-lg">
          {filteredSuggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => handleAddTag(suggestion)}
              className="w-full px-3 py-2 text-left hover:bg-muted transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PromptsPage() {
  const { selectedProjectId } = useSelectedProject();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isDirtyRef = useRef<boolean>(false);
  const prevIdsRef = useRef<Set<string>>(new Set());
  const [pendingSwitchId, setPendingSwitchId] = useState<string | null>(null);
  const selectRow = (id: string) => {
    if (isDirtyRef.current) setPendingSwitchId(id);
    else setSelectedId(id);
  };

  const { data } = useQuery({
    queryKey: ['prompts', selectedProjectId],
    queryFn: () => fetchPrompts(selectedProjectId as string),
    enabled: !!selectedProjectId,
  });

  useEffect(() => {
    const items = data?.items ?? [];
    const ids = new Set(items.map((p) => p.id));
    if (!selectedId && items.length > 0) {
      setSelectedId(items[0].id);
    } else if (selectedId && prevIdsRef.current.has(selectedId) && !ids.has(selectedId)) {
      setSelectedId(items[0]?.id ?? null);
    }
    prevIdsRef.current = ids;
  }, [data, selectedId]);

  const selectedSummary = data?.items?.find((p) => p.id === selectedId) ?? null;

  const createMutation = useMutation({
    mutationFn: (data: { projectId: string; title: string; content: string; tags?: string[] }) =>
      createPrompt(data),
    onSuccess: (created: PromptDetail) => {
      queryClient.invalidateQueries({ queryKey: ['prompts', selectedProjectId] });
      setSelectedId(created.id);
      toast({ title: 'Prompt created' });
    },
    onError: () => toast({ title: 'Create failed', variant: 'destructive' }),
  });

  const handleCreate = () => {
    if (!selectedProjectId) return;
    createMutation.mutate({ projectId: selectedProjectId, title: 'Untitled', content: '' });
  };

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePrompt(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompts', selectedProjectId] });
      if (pendingDeleteId === selectedId) setSelectedId(null);
      setPendingDeleteId(null);
      toast({ title: 'Prompt deleted' });
    },
    onError: () => {
      toast({ title: 'Delete failed', variant: 'destructive' });
      setPendingDeleteId(null);
    },
  });

  if (!selectedProjectId) {
    return (
      <div className="p-6">
        <PageHeader title="Prompts" description="Manage reusable prompt content." />
        <EmptyState
          title="Select a project"
          description="Choose a project to manage its prompts."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Prompts" description="Manage reusable prompt content." />
      <div className="flex-1 min-h-0 flex gap-4">
        <aside
          hidden={isFullscreen}
          className={`shrink-0 border-r pr-2 overflow-y-auto ${isFullscreen ? 'hidden' : 'w-[280px]'}`}
        >
          <Button className="w-full mb-3" onClick={() => handleCreate()} size="sm">
            <Plus className="h-4 w-4 mr-1" /> New
          </Button>
          <ul className="space-y-1">
            {data?.items?.map((p) => (
              <li key={p.id} className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`delete ${p.title}`}
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPendingDeleteId(p.id);
                  }}
                  className="shrink-0 p-1.5 rounded-md text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => selectRow(p.id)}
                  className={`flex-1 min-w-0 text-left rounded-md px-2 py-2 text-sm ${p.id === selectedId ? 'bg-accent' : 'hover:bg-accent/50'}`}
                >
                  <div className="font-medium truncate">{p.title}</div>
                  {p.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {p.tags.slice(0, 2).map((t) => (
                        <Badge key={t} variant="secondary" className="text-xs">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <section className="flex-1 min-w-0">
          {selectedSummary ? (
            <PromptEditorPane
              key={selectedSummary.id}
              promptId={selectedSummary.id}
              isFullscreen={isFullscreen}
              onToggleFullscreen={() => setIsFullscreen((v) => !v)}
              onDirtyChange={(d) => {
                isDirtyRef.current = d;
              }}
            />
          ) : (
            <EmptyState title="No prompt selected" description="Create one to get started." />
          )}
        </section>
      </div>
      <ConfirmDialog
        open={pendingSwitchId !== null}
        title="Discard unsaved changes?"
        description="Switching prompts will lose your unsaved edits."
        confirmText="Discard"
        cancelText="Cancel"
        onConfirm={() => {
          isDirtyRef.current = false;
          setSelectedId(pendingSwitchId);
          setPendingSwitchId(null);
        }}
        onOpenChange={(open) => {
          if (!open) setPendingSwitchId(null);
        }}
      />
      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Delete prompt?"
        description="This cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (pendingDeleteId) deleteMutation.mutate(pendingDeleteId);
        }}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
      />
    </div>
  );
}

function PromptEditorPane({
  promptId,
  isFullscreen,
  onToggleFullscreen,
  onDirtyChange,
}: {
  promptId: string;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: detail } = useQuery({
    queryKey: ['prompt', promptId],
    queryFn: () => fetchPromptDetail(promptId),
  });

  const [draft, setDraft] = useState<PromptDetail | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (detail && !dirtyRef.current) setDraft(detail);
  }, [detail, promptId]);

  const dirty =
    draft != null &&
    detail != null &&
    (draft.title !== detail.title ||
      draft.content !== detail.content ||
      JSON.stringify(draft.tags) !== JSON.stringify(detail.tags));

  dirtyRef.current = dirty;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const updateMutation = useMutation({
    mutationFn: (data: {
      id: string;
      payload: Partial<PromptDetail> & { version: number };
      version: number;
    }) => updatePromptVersioned(data.id, data.payload, data.version),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompts'] });
      queryClient.invalidateQueries({ queryKey: ['prompt', promptId] });
      toast({ title: 'Saved' });
    },
    onError: async (error: unknown) => {
      if (error instanceof OptimisticLockError) {
        toast({
          title: 'Someone else edited this prompt. Refetched. Your edits are preserved.',
          variant: 'destructive',
        });
        const fresh = await fetchPromptDetail(promptId);
        setDraft((prev) =>
          prev ? { ...fresh, content: prev.content, title: prev.title, tags: prev.tags } : fresh,
        );
        return;
      }
      toast({ title: 'Save failed', variant: 'destructive' });
    },
  });

  if (!draft) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const save = () => {
    const version = draft.version;
    updateMutation.mutate({
      id: promptId,
      payload: { title: draft.title, content: draft.content, tags: draft.tags, version },
      version,
    });
  };
  const discard = () => {
    if (detail) setDraft(detail);
  };

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-center gap-2">
        <Input
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          className="flex-1"
          aria-label="Prompt title"
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
      </div>

      <TagInput
        tags={draft.tags}
        suggestions={[]}
        onAddTag={(t) => setDraft({ ...draft, tags: [...draft.tags, t] })}
        onRemoveTag={(t) => setDraft({ ...draft, tags: draft.tags.filter((x) => x !== t) })}
      />

      <Textarea
        value={draft.content}
        onChange={(e) => setDraft({ ...draft, content: e.target.value })}
        className="flex-1 min-h-0 font-mono"
        aria-label="Prompt content"
      />

      {isFullscreen && (
        <aside className="text-xs text-muted-foreground border-t pt-2">
          <p className="font-medium mb-1">Variables</p>
          <ul className="grid grid-cols-2 gap-x-4">
            {PROMPT_VARIABLES.map((v) => (
              <li key={v.token}>
                <code>{v.token}</code> — {v.description}
              </li>
            ))}
          </ul>
        </aside>
      )}

      <div className="flex items-center justify-end gap-2">
        {dirty && (
          <span className="h-2 w-2 rounded-full bg-yellow-500" aria-label="unsaved changes" />
        )}
        <Button variant="ghost" onClick={discard} disabled={!dirty}>
          Discard
        </Button>
        <Button onClick={save} disabled={!dirty || updateMutation.isPending}>
          {updateMutation.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
