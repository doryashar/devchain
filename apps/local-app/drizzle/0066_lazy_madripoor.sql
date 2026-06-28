CREATE TABLE `epic_assignment_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`match_type` text NOT NULL,
	`status_id` text,
	`tags` text,
	`target_type` text NOT NULL,
	`target_agent_id` text,
	`target_team_id` text,
	`override_existing` integer DEFAULT false NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `epic_assignment_rules_project_id_idx` ON `epic_assignment_rules` (`project_id`);--> statement-breakpoint
CREATE INDEX `epic_assignment_rules_status_id_idx` ON `epic_assignment_rules` (`status_id`);