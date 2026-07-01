import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { useEffectivePrompt } from '@/ui/hooks/useEffectivePrompt';
import { EffectivePromptPreview } from './EffectivePromptPreview';

interface QuickViewProfile {
  id: string;
  name: string;
}

export function EffectivePromptQuickViewDialog({
  profile,
  onClose,
}: {
  profile: QuickViewProfile | null;
  onClose: () => void;
}) {
  const effective = useEffectivePrompt(profile?.id ?? null);
  return (
    <Dialog
      open={profile !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{profile?.name} — effective prompt</DialogTitle>
        </DialogHeader>
        <EffectivePromptPreview data={effective.data ?? null} isLoading={effective.isLoading} />
      </DialogContent>
    </Dialog>
  );
}
