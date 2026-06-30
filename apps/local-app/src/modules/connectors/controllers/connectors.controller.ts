import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { ConnectorsService } from '../services/connectors.service';
import { TaskimAdapter } from '../adapters/taskim.adapter';
import {
  CreateConnectorDtoSchema,
  UpdateConnectorDtoSchema,
  CreateStatusMappingDtoSchema,
  PreviewWorkspacesDtoSchema,
  PreviewProjectsDtoSchema,
} from '../dtos/connector.dto';

@Controller('api/connectors')
export class ConnectorsController {
  constructor(
    private readonly service: ConnectorsService,
    private readonly taskimAdapter: TaskimAdapter,
  ) {}

  @Get()
  async list(@Query('projectId') projectId?: string) {
    if (!projectId) throw new BadRequestException('projectId is required');
    return this.service.list(projectId);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post()
  async create(@Body() body: unknown) {
    const parsed = CreateConnectorDtoSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: parsed.error.errors,
      });
    }
    const data = parsed.data;
    const config = { ...data.config };
    let externalProjectId = data.externalProjectId ?? null;

    if (data.newWorkspaceName) {
      const created = await this.taskimAdapter.createWorkspace(config, data.newWorkspaceName);
      config.workspaceId = created.id;
    }
    if (data.newProjectName) {
      const created = await this.taskimAdapter.createProject(config, data.newProjectName);
      externalProjectId = created.id;
    }

    const { newWorkspaceName: _w, newProjectName: _p, ...rest } = data;
    return this.service.create({ ...rest, config, externalProjectId });
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const parsed = UpdateConnectorDtoSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: parsed.error.errors,
      });
    }
    return this.service.update(id, parsed.data);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    await this.service.delete(id);
    return { success: true };
  }

  @Get(':id/status-mappings')
  async listStatusMappings(@Param('id') connectorId: string) {
    return this.service.listStatusMappings(connectorId);
  }

  @Post(':id/status-mappings')
  async createStatusMapping(@Param('id') connectorId: string, @Body() body: unknown) {
    const parsed = CreateStatusMappingDtoSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: parsed.error.errors,
      });
    }
    return this.service.createStatusMapping(
      connectorId,
      parsed.data.devchainStatusLabel,
      parsed.data.externalStatusId,
      parsed.data.direction,
    );
  }

  @Delete(':id/status-mappings/:mappingId')
  async deleteStatusMapping(@Param('mappingId') mappingId: string) {
    await this.service.deleteStatusMapping(mappingId);
    return { success: true };
  }

  @Get(':id/sync-states')
  async listSyncStates(@Param('id') connectorId: string) {
    return this.service.listSyncStates(connectorId);
  }

  @Post(':id/test')
  async testConnection(@Param('id') id: string) {
    const connector = await this.service.get(id);
    const adapter = connector.type === 'taskim' ? this.taskimAdapter : null;
    if (!adapter) {
      return {
        success: false,
        error: `Adapter for type "${connector.type}" not implemented`,
      };
    }
    return adapter.testConnection(connector.config);
  }

  @Post('taskim/preview-workspaces')
  async previewWorkspaces(@Body() body: unknown) {
    const parsed = PreviewWorkspacesDtoSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: parsed.error.errors,
      });
    }
    const { apiUrl, apiKey } = parsed.data;
    return this.taskimAdapter.listWorkspaces({ apiUrl, credentials: { token: apiKey } });
  }

  @Post('taskim/preview-projects')
  async previewProjects(@Body() body: unknown) {
    const parsed = PreviewProjectsDtoSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: parsed.error.errors,
      });
    }
    const { apiUrl, apiKey, workspaceId } = parsed.data;
    return this.taskimAdapter.listProjects({
      apiUrl,
      credentials: { token: apiKey },
      workspaceId,
    });
  }
}
