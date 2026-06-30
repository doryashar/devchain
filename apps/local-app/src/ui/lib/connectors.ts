export interface Connector {
  id: string;
  projectId: string;
  type: 'taskim' | 'monday' | 'jira';
  name: string;
  enabled: boolean;
  config: {
    apiUrl: string;
    credentials: Record<string, string>;
    workspaceId?: string;
  };
  externalProjectId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StatusMapping {
  id: string;
  connectorId: string;
  devchainStatusLabel: string;
  externalStatusId: string;
  direction: 'both' | 'push' | 'pull';
}

export class ConnectorApiError extends Error {
  public readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ConnectorApiError';
    this.status = status;
  }
}

async function throwOnError(response: Response, fallback: string): Promise<never> {
  const error = await response.json().catch(() => ({ message: fallback }));
  throw new ConnectorApiError(error.message || fallback, response.status);
}

export async function fetchConnectors(projectId: string): Promise<Connector[]> {
  const response = await fetch(`/api/connectors?projectId=${projectId}`);
  if (!response.ok) await throwOnError(response, 'Failed to fetch connectors');
  return response.json();
}

export async function createConnector(
  data: Partial<Connector> & {
    projectId: string;
    type: string;
    name: string;
    newWorkspaceName?: string;
    newProjectName?: string;
  },
): Promise<Connector> {
  const response = await fetch('/api/connectors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) await throwOnError(response, 'Failed to create connector');
  return response.json();
}

export async function updateConnector(
  id: string,
  data: Partial<Connector>,
): Promise<Connector> {
  const response = await fetch(`/api/connectors/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) await throwOnError(response, 'Failed to update connector');
  return response.json();
}

export async function deleteConnector(id: string): Promise<void> {
  const response = await fetch(`/api/connectors/${id}`, { method: 'DELETE' });
  if (!response.ok) await throwOnError(response, 'Failed to delete connector');
}

export async function testConnection(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`/api/connectors/${id}/test`, { method: 'POST' });
  if (!response.ok) await throwOnError(response, 'Connection test failed');
  return response.json();
}

export async function previewWorkspaces(input: {
  apiUrl: string;
  apiKey: string;
}): Promise<{ id: string; name: string }[]> {
  const response = await fetch('/api/connectors/taskim/preview-workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) await throwOnError(response, 'Failed to load workspaces');
  return response.json();
}

export async function previewProjects(input: {
  apiUrl: string;
  apiKey: string;
  workspaceId: string;
}): Promise<{ id: string; name: string }[]> {
  const response = await fetch('/api/connectors/taskim/preview-projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) await throwOnError(response, 'Failed to load projects');
  return response.json();
}

export async function fetchStatusMappings(connectorId: string): Promise<StatusMapping[]> {
  const response = await fetch(`/api/connectors/${connectorId}/status-mappings`);
  if (!response.ok) await throwOnError(response, 'Failed to fetch status mappings');
  return response.json();
}

export async function createStatusMapping(
  connectorId: string,
  data: { devchainStatusLabel: string; externalStatusId: string; direction?: string },
): Promise<StatusMapping> {
  const response = await fetch(`/api/connectors/${connectorId}/status-mappings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectorId, ...data }),
  });
  if (!response.ok) await throwOnError(response, 'Failed to create status mapping');
  return response.json();
}

export async function deleteStatusMapping(
  connectorId: string,
  mappingId: string,
): Promise<void> {
  const response = await fetch(
    `/api/connectors/${connectorId}/status-mappings/${mappingId}`,
    { method: 'DELETE' },
  );
  if (!response.ok) await throwOnError(response, 'Failed to delete status mapping');
}
