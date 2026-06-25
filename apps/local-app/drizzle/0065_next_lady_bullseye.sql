CREATE TABLE `provider_env_scopes` (
	`provider_id` text NOT NULL,
	`env_key` text NOT NULL,
	`project_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`provider_id`, `env_key`, `project_id`),
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `provider_env_scopes_project_id_idx` ON `provider_env_scopes` (`project_id`);