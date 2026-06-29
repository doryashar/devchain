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
    newWorkspaceName: z.string().min(1).optional(),
    newProjectName: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.config.workspaceId && data.newWorkspaceName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['newWorkspaceName'],
        message: 'Provide either workspaceId or newWorkspaceName, not both',
      });
    }
    if (data.externalProjectId && data.newProjectName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['newProjectName'],
        message: 'Provide either externalProjectId or newProjectName, not both',
      });
    }
  });

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
    newWorkspaceName: z.string().min(1).optional(),
    newProjectName: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.config?.workspaceId && data.newWorkspaceName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['newWorkspaceName'],
        message: 'Provide either workspaceId or newWorkspaceName, not both',
      });
    }
    if (data.externalProjectId && data.newProjectName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['newProjectName'],
        message: 'Provide either externalProjectId or newProjectName, not both',
      });
    }
  });

export type UpdateConnectorDto = z.infer<typeof UpdateConnectorDtoSchema>;

export const PreviewWorkspacesDtoSchema = z
  .object({
    apiUrl: z.string().url(),
    apiKey: z.string().min(1),
  })
  .strict();
export type PreviewWorkspacesDto = z.infer<typeof PreviewWorkspacesDtoSchema>;

export const PreviewProjectsDtoSchema = z
  .object({
    apiUrl: z.string().url(),
    apiKey: z.string().min(1),
    workspaceId: z.string().min(1),
  })
  .strict();
export type PreviewProjectsDto = z.infer<typeof PreviewProjectsDtoSchema>;

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
