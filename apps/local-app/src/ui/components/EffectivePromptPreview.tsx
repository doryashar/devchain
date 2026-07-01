import { MarkdownRenderer } from '@/ui/components/shared';

export interface EffectivePromptData {
  contentMd: string;
  truncated: boolean;
  maxBytes: number;
  references: { title: string; resolved: boolean }[];
  unreferencedAssigned: { title: string }[];
}

export function EffectivePromptPreview({
  data,
  isLoading,
}: {
  data: EffectivePromptData | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading effective prompt…</p>;
  }
  if (!data) {
    return null;
  }

  const unresolved = data.references.filter((r) => !r.resolved);

  return (
    <div className="space-y-3">
      {data.truncated && (
        <div className="rounded-md border border-yellow-500 bg-yellow-500/10 p-3 text-sm text-yellow-900">
          Effective prompt was truncated at 64 KB.
        </div>
      )}
      {unresolved.length > 0 && (
        <div className="rounded-md border border-red-500 bg-red-500/10 p-3 text-sm text-red-900">
          <p className="font-medium">Unresolved references (prompt not found):</p>
          <ul className="ml-4 list-disc">
            {unresolved.map((r) => (
              <li key={r.title}>{r.title}</li>
            ))}
          </ul>
        </div>
      )}
      {data.unreferencedAssigned.length > 0 && (
        <div className="rounded-md border border-orange-500 bg-orange-500/10 p-3 text-sm text-orange-900">
          <p className="font-medium">
            These assigned prompts are not referenced inline and won't reach the agent:
          </p>
          <ul className="ml-4 list-disc">
            {data.unreferencedAssigned.map((p) => (
              <li key={p.title}>{p.title}</li>
            ))}
          </ul>
        </div>
      )}
      {data.contentMd ? (
        <div className="rounded-md border bg-muted/30 p-4 max-h-[480px] overflow-y-auto">
          <MarkdownRenderer content={data.contentMd} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">This profile has no instructions.</p>
      )}
    </div>
  );
}
