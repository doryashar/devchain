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
import {
  CreateConnectorDtoSchema,
  UpdateConnectorDtoSchema,
  CreateStatusMappingDtoSchema,
} from '../dtos/connector.dto';

@Controller('api/connectors')
export class ConnectorsController {
  constructor(private readonly service: ConnectorsService) {}

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
    return this.service.create(parsed.data);
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
}
