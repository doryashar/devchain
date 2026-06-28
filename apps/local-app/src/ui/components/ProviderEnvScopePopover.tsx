import { useState } from 'react';
import { Filter } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Checkbox } from '@/ui/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/components/ui/popover';
import { cn } from '@/ui/lib/utils';

interface Props {
  envKey: string;
  selectedProjectIds: string[];
  allProjects: Array<{ id: string; name: string }>;
  onChange: (projectIds: string[]) => void;
}

export function ProviderEnvScopePopover({
  envKey,
  selectedProjectIds,
  allProjects,
  onChange,
}: Props) {
  const [search, setSearch] = useState('');

  const filtered = allProjects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  const isScoped = selectedProjectIds.length > 0;

  const toggle = (projectId: string) => {
    if (selectedProjectIds.includes(projectId)) {
      onChange(selectedProjectIds.filter((id) => id !== projectId));
    } else {
      onChange([...selectedProjectIds, projectId]);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Scope ${envKey} to projects`}
          className={cn('gap-1', isScoped && 'text-primary')}
        >
          <Filter className={cn('h-4 w-4', isScoped ? 'fill-current' : '')} />
          {isScoped && <span className="text-xs font-medium">({selectedProjectIds.length})</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="end">
        <div className="space-y-2">
          <Input
            placeholder="Search projects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-sm"
          />
          <div className="max-h-48 overflow-y-auto space-y-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2 text-center">No projects found</p>
            ) : (
              filtered.map((project) => (
                <label
                  key={project.id}
                  className="flex items-center gap-2 rounded px-1 py-1 cursor-pointer hover:bg-muted text-sm"
                >
                  <Checkbox
                    checked={selectedProjectIds.includes(project.id)}
                    onCheckedChange={() => toggle(project.id)}
                    id={`scope-${envKey}-${project.id}`}
                  />
                  <span className="truncate">{project.name}</span>
                </label>
              ))
            )}
          </div>
          <p className="text-xs text-muted-foreground border-t pt-2">
            No projects selected = applies to all projects
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
