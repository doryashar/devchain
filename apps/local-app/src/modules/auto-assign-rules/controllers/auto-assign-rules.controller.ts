import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Body,
  Param,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { AutoAssignRulesService } from '../services/auto-assign-rules.service';
import {
  CreateEpicAssignmentRuleDtoSchema,
  UpdateEpicAssignmentRuleDtoSchema,
  ReorderEpicAssignmentRulesDtoSchema,
} from '../dtos/auto-assign-rule.dto';

@Controller('api/auto-assign-rules')
export class AutoAssignRulesController {
  constructor(private readonly service: AutoAssignRulesService) {}

  @Get()
  async list(@Query('projectId') projectId?: string) {
    if (!projectId) throw new BadRequestException('projectId is required');
    return this.service.list(projectId);
  }

  @Post()
  async create(@Query('projectId') projectId: string, @Body() body: unknown) {
    if (!projectId) throw new BadRequestException('projectId is required');
    const parsed = CreateEpicAssignmentRuleDtoSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Validation failed', errors: parsed.error.errors });
    }
    return this.service.create(projectId, parsed.data);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const parsed = UpdateEpicAssignmentRuleDtoSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Validation failed', errors: parsed.error.errors });
    }
    return this.service.update(id, parsed.data);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    await this.service.delete(id);
    return { success: true };
  }

  @Put('reorder')
  async reorder(@Query('projectId') projectId: string, @Body() body: unknown) {
    if (!projectId) throw new BadRequestException('projectId is required');
    const parsed = ReorderEpicAssignmentRulesDtoSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Validation failed', errors: parsed.error.errors });
    }
    await this.service.reorder(projectId, parsed.data.items);
    return { success: true };
  }
}
