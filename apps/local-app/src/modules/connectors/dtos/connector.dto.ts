import { z } from 'zod';

export const CreateConnectorDtoSchema = z
  .object({
    projectId: z.string().uuid(),
    type: z.enum(['taskim', 'monday', 'jira']),
    name: z.string().min(1).max(200),
    enabled: z.boolean().optional().default(false),
    config: z
      .object({
        apiUrl: z.string().url(),
        credentials: z.record(z.string()).default({}),
        workspaceId: z.string().optional(),
      })
      .passthrough(),
    externalProjectId: z.string().nullable().optional(),
  })
  .strict();

export type CreateConnectorDto = z.infer<typeof CreateConnectorDtoSchema>;

export const UpdateConnectorDtoSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    enabled: z.boolean().optional(),
    config: z
      .object({
        apiUrl: z.string().url(),
        credentials: z.record(z.string()).default({}),
        workspaceId: z.string().optional(),
      })
      .passthrough()
      .optional(),
    externalProjectId: z.string().nullable().optional(),
  })
  .strict();

export type UpdateConnectorDto = z.infer<typeof UpdateConnectorDtoSchema>;

export const CreateStatusMappingDtoSchema = z
  .object({
    connectorId: z.string().uuid(),
    devchainStatusLabel: z.string().min(1),
    externalStatusId: z.string().min(1),
    direction: z.enum(['both', 'push', 'pull']).optional().default('both'),
  })
  .strict();

export type CreateStatusMappingDto = z.infer<typeof CreateStatusMappingDtoSchema>;

export const UpdateStatusMappingDtoSchema = z
  .object({
    devchainStatusLabel: z.string().min(1).optional(),
    externalStatusId: z.string().min(1).optional(),
    direction: z.enum(['both', 'push', 'pull']).optional(),
  })
  .strict();

export type UpdateStatusMappingDto = z.infer<typeof UpdateStatusMappingDtoSchema>;
