import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PromptsPage } from './PromptsPage';
const useSelectedProjectMock = jest.fn();

const toastSpy = jest.fn();

jest.mock('@/ui/hooks/use-toast', () => ({
  useToast: () => ({
    toast: (opts: { title?: string; description?: string; variant?: string }) => {
      toastSpy(opts);
      let container = document.getElementById('toast-root');
      if (!container) {
        container = document.createElement('div');
        container.setAttribute('id', 'toast-root');
        document.body.appendChild(container);
      }
      const el = document.createElement('div');
      el.setAttribute('data-testid', 'toast-item');
      el.textContent = opts?.title ?? '';
      container.appendChild(el);
    },
  }),
}));

jest.mock('@/ui/hooks/useProjectSelection', () => ({
  useSelectedProject: () => useSelectedProjectMock(),
}));

jest.mock('@/ui/components/shared/ConfirmDialog', () => ({
  ConfirmDialog: ({
    open,
    title,
    confirmText,
    cancelText,
    onConfirm,
    onOpenChange,
  }: {
    open: boolean;
    title: string;
    confirmText: string;
    cancelText: string;
    onConfirm: () => void;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div>
        <p>{title}</p>
        <button type="button" onClick={() => onOpenChange(false)}>
          {cancelText}
        </button>
        <button type="button" onClick={onConfirm}>
          {confirmText}
        </button>
      </div>
    ) : null,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { Wrapper, queryClient };
}

describe('PromptsPage', () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn();

  beforeEach(() => {
    useSelectedProjectMock.mockReturnValue({
      selectedProjectId: 'project-1',
      selectedProject: { id: 'project-1', name: 'Demo' },
    });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.startsWith('/api/prompts?projectId=project-1')) {
        return {
          ok: true,
          json: async () => ({
            items: [
              {
                id: 'prompt-1',
                projectId: 'project-1',
                title: 'Prompt A',
                contentPreview: 'Preview A',
                version: 1,
                tags: ['ops'],
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-02T00:00:00.000Z',
              },
            ],
            total: 1,
            limit: 50,
            offset: 0,
          }),
        } as Response;
      }

      if (url === '/api/prompts/prompt-1') {
        return {
          ok: true,
          json: async () => ({
            id: 'prompt-1',
            projectId: 'project-1',
            title: 'Prompt A',
            content: 'Prompt content',
            contentPreview: 'Preview A',
            version: 1,
            tags: ['ops'],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    fetchMock.mockReset();
    toastSpy.mockReset();
    document.getElementById('toast-root')?.remove();
  });

  it('auto-selects the first prompt and shows its content in the editor on load', async () => {
    const { Wrapper } = createWrapper();

    await act(async () => {
      render(
        <Wrapper>
          <PromptsPage />
        </Wrapper>,
      );
    });

    expect(await screen.findByText('Prompt A')).toBeInTheDocument();
    const editor = await screen.findByRole('textbox', { name: /prompt content/i });
    expect(editor).toHaveValue('Prompt content');
  });

  it('edits content, marks dirty, and saves via PUT with the current version', async () => {
    const putCalls: Array<{ version: number; content: string }> = [];
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/prompts?projectId')) {
        return {
          ok: true,
          json: async () => ({
            items: [
              { id: 'prompt-1', title: 'Prompt A', contentPreview: '', version: 3, tags: ['ops'] },
            ],
          }),
        } as Response;
      }
      if (method === 'GET' && url === '/api/prompts/prompt-1') {
        return {
          ok: true,
          json: async () => ({
            id: 'prompt-1',
            title: 'Prompt A',
            content: 'Prompt content',
            version: 3,
            tags: ['ops'],
          }),
        } as Response;
      }
      if (method === 'PUT' && url === '/api/prompts/prompt-1') {
        putCalls.push(JSON.parse(String(init?.body)));
        return {
          ok: true,
          json: async () => ({
            id: 'prompt-1',
            title: 'Prompt A',
            content: 'new content',
            version: 4,
            tags: ['ops'],
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    const { Wrapper } = createWrapper();
    await act(async () => {
      render(
        <Wrapper>
          <PromptsPage />
        </Wrapper>,
      );
    });
    const editor = await screen.findByRole('textbox', { name: /prompt content/i });
    await userEvent.clear(editor);
    await userEvent.type(editor, 'new content');

    const saveButton = await screen.findByRole('button', { name: /save/i });
    expect(saveButton).toBeEnabled();
    await userEvent.click(saveButton);

    await waitFor(() => expect(putCalls).toHaveLength(1));
    expect(putCalls[0].version).toBe(3);
    expect(putCalls[0].content).toBe('new content');
  });

  it('on 409 conflict, toasts and refetches while preserving user content', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/prompts?projectId')) {
        return {
          ok: true,
          json: async () => ({
            items: [
              { id: 'prompt-1', title: 'Prompt A', contentPreview: '', version: 5, tags: ['ops'] },
            ],
          }),
        } as Response;
      }
      if (method === 'GET' && url === '/api/prompts/prompt-1') {
        return {
          ok: true,
          json: async () => ({
            id: 'prompt-1',
            title: 'Prompt A',
            content: 'Prompt content',
            version: 5,
            tags: ['ops'],
          }),
        } as Response;
      }
      if (method === 'PUT' && url === '/api/prompts/prompt-1') {
        return {
          ok: false,
          status: 409,
          json: async () => ({ code: 'optimistic_lock_error', message: 'version mismatch' }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    const { Wrapper } = createWrapper();
    await act(async () => {
      render(
        <Wrapper>
          <PromptsPage />
        </Wrapper>,
      );
    });
    const editor = await screen.findByRole('textbox', { name: /prompt content/i });
    await userEvent.clear(editor);
    await userEvent.type(editor, 'my local edit');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/Someone else edited/i)).toBeInTheDocument();
    expect(editor).toHaveValue('my local edit');
  });

  it('fullscreen toggle hides the left rail', async () => {
    const { Wrapper } = createWrapper();
    await act(async () => {
      render(
        <Wrapper>
          <PromptsPage />
        </Wrapper>,
      );
    });
    expect(await screen.findByRole('button', { name: /^new$/i })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /enter fullscreen/i }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^new$/i })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /exit fullscreen/i })).toBeInTheDocument();
  });
});
