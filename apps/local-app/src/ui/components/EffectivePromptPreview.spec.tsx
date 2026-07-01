import { render, screen } from '@testing-library/react';
import { EffectivePromptPreview } from './EffectivePromptPreview';

jest.mock('@/ui/components/shared', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown">{content}</div>
  ),
}));

describe('EffectivePromptPreview', () => {
  it('renders the resolved content', () => {
    render(
      <EffectivePromptPreview
        data={{
          contentMd: 'do the work',
          truncated: false,
          maxBytes: 65536,
          references: [{ title: 'Worker SOP', resolved: true }],
          unreferencedAssigned: [],
        }}
        isLoading={false}
      />,
    );
    expect(screen.getByTestId('markdown')).toHaveTextContent('do the work');
  });

  it('shows the truncation banner when truncated', () => {
    render(
      <EffectivePromptPreview
        data={{
          contentMd: 'x',
          truncated: true,
          maxBytes: 65536,
          references: [],
          unreferencedAssigned: [],
        }}
        isLoading={false}
      />,
    );
    expect(screen.getByText(/truncated at 64 KB/i)).toBeInTheDocument();
  });

  it('lists unresolved references and unreferenced assigned prompts', () => {
    render(
      <EffectivePromptPreview
        data={{
          contentMd: 'x',
          truncated: false,
          maxBytes: 65536,
          references: [{ title: 'Missing', resolved: false }],
          unreferencedAssigned: [{ title: 'Orphan SOP' }],
        }}
        isLoading={false}
      />,
    );
    expect(screen.getByText(/Unresolved references/i)).toBeInTheDocument();
    expect(screen.getByText(/won't reach the agent/i)).toBeInTheDocument();
    expect(screen.getByText('Orphan SOP')).toBeInTheDocument();
  });

  it('renders a loading state', () => {
    render(<EffectivePromptPreview data={null} isLoading={true} />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });
});
