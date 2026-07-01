import { useQuery } from '@tanstack/react-query';
import type { EffectivePromptData } from '@/ui/components/EffectivePromptPreview';

async function fetchEffectivePrompt(profileId: string): Promise<EffectivePromptData> {
  const res = await fetch(`/api/profiles/${encodeURIComponent(profileId)}/effective-prompt`);
  if (!res.ok) throw new Error('Failed to fetch effective prompt');
  return res.json();
}

export function useEffectivePrompt(profileId: string | null | undefined) {
  return useQuery({
    queryKey: ['effective-prompt', profileId],
    queryFn: () => fetchEffectivePrompt(profileId as string),
    enabled: !!profileId,
    staleTime: 30_000,
  });
}
