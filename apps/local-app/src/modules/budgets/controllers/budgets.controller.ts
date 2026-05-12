import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { createLogger } from '../../../common/logging/logger';
import { BudgetsService } from '../services/budgets.service';
import {
  CreateBudgetSchema,
  UpdateBudgetSchema,
  ToggleBudgetSchema,
  type CreateBudgetData,
  type UpdateBudgetData,
  type BudgetDto,
  type SpendRecordDto,
  type SpendSummaryDto,
} from '../dtos/budget.dto';
import type { Budget, SpendRecord } from '../../storage/models/domain.models';

const logger = createLogger('BudgetsController');

@Controller('api/budgets')
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Get()
  async listBudgets(
    @Query('scope') scope?: string,
    @Query('projectId') projectId?: string,
  ): Promise<BudgetDto[]> {
    logger.info({ scope, projectId }, 'GET /api/budgets');
    const budgets = await this.budgetsService.listBudgets(scope, projectId);
    return budgets.map((b) => this.toDto(b));
  }

  @Get('summary')
  async getSummary(@Query('projectId') projectId?: string): Promise<SpendSummaryDto[]> {
    logger.info({ projectId }, 'GET /api/budgets/summary');

    if (!projectId) {
      throw new BadRequestException('projectId query parameter is required');
    }

    const statuses = await this.budgetsService.listBudgetStatusesForProject(projectId);
    const now = new Date();

    return statuses.map((s) => ({
      projectId,
      totalSpendUsd: s.budget.currentSpendUsd,
      period: s.budget.period,
      since: this.budgetsService.computeWindowStart(s.budget),
      byModel: {},
    }));
  }

  @Get(':id')
  async getBudget(@Param('id') id: string): Promise<BudgetDto> {
    logger.info({ id }, 'GET /api/budgets/:id');
    const status = await this.budgetsService.getBudgetStatus(id);
    return this.toDto(status.budget, status.percentUsed, status.remainingUsd);
  }

  @Get(':id/spend')
  async listSpend(
    @Param('id') id: string,
    @Query('periodStart') periodStart?: string,
  ): Promise<SpendRecordDto[]> {
    logger.info({ id }, 'GET /api/budgets/:id/spend');
    const records = await this.budgetsService.listSpendRecords(id, periodStart);
    return records.map(this.toSpendRecordDto);
  }

  @Post()
  async createBudget(@Body() body: unknown): Promise<BudgetDto> {
    logger.info('POST /api/budgets');

    const parseResult = CreateBudgetSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: parseResult.error.errors,
      });
    }

    const data: CreateBudgetData = parseResult.data;
    const budget = await this.budgetsService.createBudget({
      scope: data.scope,
      projectId: data.projectId ?? null,
      name: data.name,
      description: data.description ?? null,
      enabled: data.enabled,
      limitUsd: data.limitUsd,
      period: data.period,
      periodStartDate: data.periodStartDate ?? null,
      action: data.action,
      thresholdPercent: data.thresholdPercent,
    });

    return this.toDto(budget);
  }

  @Put(':id')
  async updateBudget(@Param('id') id: string, @Body() body: unknown): Promise<BudgetDto> {
    logger.info({ id }, 'PUT /api/budgets/:id');

    const parseResult = UpdateBudgetSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: parseResult.error.errors,
      });
    }

    const budget = await this.budgetsService.updateBudget(id, parseResult.data);
    return this.toDto(budget);
  }

  @Delete(':id')
  async deleteBudget(@Param('id') id: string): Promise<void> {
    logger.info({ id }, 'DELETE /api/budgets/:id');
    await this.budgetsService.deleteBudget(id);
  }

  @Post(':id/toggle')
  async toggleBudget(@Param('id') id: string, @Body() body: unknown): Promise<BudgetDto> {
    logger.info({ id }, 'POST /api/budgets/:id/toggle');

    const parseResult = ToggleBudgetSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: parseResult.error.errors,
      });
    }

    const budget = await this.budgetsService.toggleBudget(id, parseResult.data.enabled);
    return this.toDto(budget);
  }

  private toDto(budget: Budget, percentUsed?: number, remainingUsd?: number): BudgetDto {
    const pct = percentUsed ?? (budget.limitUsd > 0 ? (budget.currentSpendUsd / budget.limitUsd) * 100 : 0);
    const rem = remainingUsd ?? Math.max(0, budget.limitUsd - budget.currentSpendUsd);
    return {
      id: budget.id,
      scope: budget.scope,
      projectId: budget.projectId,
      name: budget.name,
      description: budget.description,
      enabled: budget.enabled,
      limitUsd: budget.limitUsd,
      period: budget.period,
      periodStartDate: budget.periodStartDate,
      action: budget.action,
      thresholdPercent: budget.thresholdPercent,
      currentSpendUsd: budget.currentSpendUsd,
      spendWindowStart: budget.spendWindowStart,
      lastEvaluatedAt: budget.lastEvaluatedAt,
      percentUsed: Math.round(pct * 100) / 100,
      remainingUsd: Math.round(rem * 100) / 100,
      createdAt: budget.createdAt,
      updatedAt: budget.updatedAt,
    };
  }

  private toSpendRecordDto(record: SpendRecord): SpendRecordDto {
    return { ...record };
  }
}
