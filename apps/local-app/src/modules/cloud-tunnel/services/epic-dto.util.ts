/**
 * Serialize a raw epic into the mobile board DTO shape shared by the tunnel
 * board reads (`board.getEpicDetail` / list endpoints) and the board mutations
 * (`MobileBoardRpcService`). Keeping a single builder guarantees the mutation
 * responses are shape-identical to the reads the mobile client already renders.
 *
 * `projectId` and `version` are included so the client can drive the assignment
 * picker (project scope) and optimistic-lock retries (version). `agentName` is
 * resolved from the optional `agentNameById` map (falling back to a raw
 * `agentName` on the epic, when present); status fields resolve from the optional
 * `statusMap`. Both maps are optional — callers that only need the assignment
 * fields may omit them.
 */
/**
 * Normalize a raw status row into the DTO the mobile board renders. The raw row
 * uses `label`; older/seeded rows may carry `name` — prefer `name` when present.
 * Shared by the tunnel board reads and the board mutations so both produce the
 * same status shape.
 */
export function toStatusDto(status: Record<string, unknown>): Record<string, unknown> {
  return {
    id: status.id,
    name: status.name ?? status.label,
    color: status.color,
    position: status.position,
  };
}

/** Build a `statusId → status DTO` map from a list of raw status rows. */
export function toStatusMap(
  statuses: Array<Record<string, unknown>>,
): Map<string, Record<string, unknown>> {
  return new Map(
    statuses
      .filter((status) => typeof status.id === 'string')
      .map((status) => [status.id as string, toStatusDto(status)]),
  );
}

export function toEpicDto(
  epic: Record<string, unknown>,
  statusMap?: Map<string, Record<string, unknown>>,
  agentNameById?: Map<string, string>,
): Record<string, unknown> {
  const statusId = epic.statusId as string | undefined;
  const status = statusId ? statusMap?.get(statusId) : undefined;
  const agentId = (epic.agentId as string | null | undefined) ?? null;
  const resolvedAgentName =
    (agentId ? agentNameById?.get(agentId) : undefined) ?? (epic.agentName as string | undefined);

  return {
    id: epic.id,
    projectId: epic.projectId,
    title: epic.title,
    statusId,
    statusName: status?.name,
    statusColor: status?.color,
    statusPosition: status?.position,
    status,
    agentId,
    agentName: resolvedAgentName,
    parentId: epic.parentId,
    version: epic.version,
    updatedAt: epic.updatedAt,
    description: epic.description,
    createdAt: epic.createdAt,
    tags: epic.tags,
  };
}
