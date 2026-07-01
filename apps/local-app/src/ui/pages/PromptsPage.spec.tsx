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
    description,
    confirmText,
    cancelText,
    onConfirm,
    onOpenChange,
  }: {
    open: boolean;
    title: string;
    description?: string;
    confirmText: string;
    cancelText: string;
    onConfirm: () => void;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <p>{description}</p>
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

  it('after a 409, retry sends the bumped version', async () => {
    let getVersion = 5;
    const putVersions: number[] = [];
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
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
        const v = getVersion;
        return {
          ok: true,
          json: async () => ({
            id: 'prompt-1',
            title: 'Prompt A',
            content: 'Prompt content',
            version: v,
            tags: ['ops'],
          }),
        } as Response;
      }
      if (method === 'PUT' && url === '/api/prompts/prompt-1') {
        putVersions.push(JSON.parse(init!.body as string).version);
        if (putVersions.length === 1) {
          getVersion = 6;
          return {
            ok: false,
            status: 409,
            json: async () => ({ code: 'optimistic_lock_error' }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({
            id: 'prompt-1',
            title: 'Prompt A',
            content: 'my local edit',
            version: 6,
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
    await userEvent.type(editor, 'my local edit');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await screen.findByText(/Someone else edited/i);
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(putVersions).toEqual([5, 6]));
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

  it('warns before switching rows when there are unsaved changes', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      void init;
      if (url.startsWith('/api/prompts?projectId')) {
        return {
          ok: true,
          json: async () => ({
            items: [
              { id: 'prompt-1', title: 'First Prompt', contentPreview: '', version: 1, tags: [] },
              { id: 'prompt-2', title: 'Second Prompt', contentPreview: '', version: 1, tags: [] },
            ],
          }),
        } as Response;
      }
      if (url === '/api/prompts/prompt-1' || url === '/api/prompts/prompt-2') {
        const isFirst = url === '/api/prompts/prompt-1';
        return {
          ok: true,
          json: async () => ({
            id: isFirst ? 'prompt-1' : 'prompt-2',
            title: isFirst ? 'First Prompt' : 'Second Prompt',
            content: 'body',
            version: 1,
            tags: [],
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
    await userEvent.type(editor, 'unsaved');
    await userEvent.click(screen.getByText('Second Prompt'));
    expect(
      await screen.findByRole('dialog', { name: /discard unsaved changes/i }),
    ).toBeInTheDocument();
  });

  it('creates a new prompt via + New and selects it', async () => {
    let createCalls = 0;
    let created = false;
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && url === '/api/prompts') {
        createCalls += 1;
        created = true;
        return {
          ok: true,
          json: async () => ({ id: 'new-1', title: 'Untitled', content: '', version: 1, tags: [] }),
        } as Response;
      }
      if (method === 'GET' && url === '/api/prompts/prompt-1') {
        return {
          ok: true,
          json: async () => ({
            id: 'prompt-1',
            title: 'Prompt A',
            content: 'Prompt content',
            version: 1,
            tags: [],
          }),
        } as Response;
      }
      if (method === 'GET' && url === '/api/prompts/new-1') {
        return {
          ok: true,
          json: async () => ({ id: 'new-1', title: 'Untitled', content: '', version: 1, tags: [] }),
        } as Response;
      }
      if (url.startsWith('/api/prompts?projectId')) {
        const items = created
          ? [
              { id: 'prompt-1', title: 'Prompt A', contentPreview: '', version: 1, tags: [] },
              { id: 'new-1', title: 'Untitled', contentPreview: '', version: 1, tags: [] },
            ]
          : [{ id: 'prompt-1', title: 'Prompt A', contentPreview: '', version: 1, tags: [] }];
        return { ok: true, json: async () => ({ items }) } as Response;
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
    await screen.findByText('Prompt A');
    await userEvent.click(screen.getByRole('button', { name: /^new$/i }));
    await waitFor(() => expect(createCalls).toBe(1));
    expect(await screen.findByDisplayValue('Untitled')).toBeInTheDocument();
  });

  it('deletes a prompt via the row delete button after confirm', async () => {
    let deletedId = '';
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'DELETE' && url.startsWith('/api/prompts/')) {
        deletedId = url.split('/').pop()!;
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (method === 'GET' && url === '/api/prompts/prompt-1') {
        return {
          ok: true,
          json: async () => ({
            id: 'prompt-1',
            title: 'Prompt A',
            content: 'Prompt content',
            version: 1,
            tags: [],
          }),
        } as Response;
      }
      if (url.startsWith('/api/prompts?projectId')) {
        return {
          ok: true,
          json: async () => ({
            items: [
              { id: 'prompt-1', title: 'Prompt A', contentPreview: '', version: 1, tags: [] },
            ],
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
    await screen.findByText('Prompt A');
    await userEvent.click(screen.getByRole('button', { name: /delete prompt a/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(deletedId).toBe('prompt-1'));
  });
});
