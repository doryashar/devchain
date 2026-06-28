import { z } from 'zod';

const matchTypeEnum = z.enum(['status', 'tag']);
const targetTypeEnum = z.enum(['agent', 'team']);

const baseFields = {
  matchType: matchTypeEnum,
  targetType: targetTypeEnum,
  statusId: z.string().min(1).nullable(),
  tags: z.array(z.string().min(1)).nullable(),
  targetAgentId: z.string().min(1).nullable(),
  targetTeamId: z.string().min(1).nullable(),
  overrideExisting: z.boolean(),
  priority: z.number().int(),
  enabled: z.boolean(),
};

// One matcher per rule: status XOR tag.
export const CreateEpicAssignmentRuleDtoSchema = z
  .object(baseFields)
  .strict()
  .superRefine((data, ctx) => {
    if (data.matchType === 'status') {
      if (!data.statusId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['statusId'],
          message: 'statusId is required when matchType is "status"',
        });
      }
      if (data.tags !== null && data.tags !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tags'],
          message: 'tags must be null when matchType is "status"',
        });
      }
    } else {
      if (!data.tags || data.tags.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tags'],
          message: 'tags must be a non-empty array when matchType is "tag"',
        });
      }
      if (data.statusId !== null && data.statusId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['statusId'],
          message: 'statusId must be null when matchType is "tag"',
        });
      }
    }
    if (data.targetType === 'agent') {
      if (!data.targetAgentId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['targetAgentId'],
          message: 'targetAgentId is required when targetType is "agent"',
        });
      }
    } else {
      if (!data.targetTeamId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['targetTeamId'],
          message: 'targetTeamId is required when targetType is "team"',
        });
      }
    }
  });

export type CreateEpicAssignmentRuleDto = z.infer<typeof CreateEpicAssignmentRuleDtoSchema>;

export const UpdateEpicAssignmentRuleDtoSchema = z
  .object({
    matchType: matchTypeEnum.optional(),
    targetType: targetTypeEnum.optional(),
    statusId: z.string().min(1).nullable().optional(),
    tags: z.array(z.string().min(1)).nullable().optional(),
    targetAgentId: z.string().min(1).nullable().optional(),
    targetTeamId: z.string().min(1).nullable().optional(),
    overrideExisting: z.boolean().optional(),
    priority: z.number().int().optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.matchType === 'status' && data.tags !== undefined && data.tags !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tags'],
        message: 'tags must be null when matchType is "status"',
      });
    }
    if (data.matchType === 'tag' && data.statusId !== undefined && data.statusId !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['statusId'],
        message: 'statusId must be null when matchType is "tag"',
      });
    }
  });

export type UpdateEpicAssignmentRuleDto = z.infer<typeof UpdateEpicAssignmentRuleDtoSchema>;

export const ReorderEpicAssignmentRulesDtoSchema = z
  .object({
    items: z.array(z.object({ id: z.string().min(1), priority: z.number().int() })).min(1),
  })
  .strict();

export type ReorderEpicAssignmentRulesDto = z.infer<typeof ReorderEpicAssignmentRulesDtoSchema>;
