ALTER TABLE `sessions` ADD COLUMN `cost_usd` real;--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `input_tokens` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `output_tokens` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `primary_model` text;--> statement-breakpoint
CREATE TABLE `budgets` (
  `id` text PRIMARY KEY NOT NULL,
  `scope` text NOT NULL,
  `project_id` text,
  `name` text NOT NULL,
  `description` text,
  `enabled` integer DEFAULT 1 NOT NULL,
  `limit_usd` real NOT NULL,
  `period` text NOT NULL,
  `period_start_date` text,
  `action` text DEFAULT 'notify' NOT NULL,
  `threshold_percent` integer DEFAULT 80 NOT NULL,
  `current_spend_usd` real DEFAULT 0 NOT NULL,
  `spend_window_start` text,
  `last_evaluated_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `budgets_project_id_idx` ON `budgets` (`project_id`);--> statement-breakpoint
CREATE INDEX `budgets_scope_idx` ON `budgets` (`scope`);--> statement-breakpoint
CREATE INDEX `budgets_enabled_idx` ON `budgets` (`enabled`);--> statement-breakpoint
CREATE TABLE `spend_records` (
  `id` text PRIMARY KEY NOT NULL,
  `budget_id` text NOT NULL,
  `session_id` text,
  `project_id` text NOT NULL,
  `agent_id` text,
  `model` text,
  `input_tokens` integer,
  `output_tokens` integer,
  `cost_usd` real NOT NULL,
  `period_start` text NOT NULL,
  `recorded_at` text NOT NULL,
  FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE INDEX `spend_records_budget_id_idx` ON `spend_records` (`budget_id`);--> statement-breakpoint
CREATE INDEX `spend_records_project_id_idx` ON `spend_records` (`project_id`);--> statement-breakpoint
CREATE INDEX `spend_records_period_start_idx` ON `spend_records` (`period_start`);
