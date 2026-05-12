import { Module, forwardRef } from '@nestjs/common';
import { BudgetsController } from './controllers/budgets.controller';
import { StorageModule } from '../storage/storage.module';
import { SessionsModule } from '../sessions/sessions.module';
import { EventsDomainModule } from '../events/events-domain.module';
import { BudgetsService } from './services/budgets.service';
import { BudgetEvaluatorService } from './services/budget-evaluator.service';

@Module({
  imports: [StorageModule, forwardRef(() => SessionsModule), EventsDomainModule],
  controllers: [BudgetsController],
  providers: [BudgetsService, BudgetEvaluatorService],
  exports: [BudgetsService, BudgetEvaluatorService],
})
export class BudgetsModule {}
