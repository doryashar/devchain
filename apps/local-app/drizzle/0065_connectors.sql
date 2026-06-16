CREATE TABLE `connectors` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`config` text NOT NULL,
	`external_project_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `connectors_project_id_idx` ON `connectors` (`project_id`);
--> statement-breakpoint
CREATE INDEX `connectors_type_idx` ON `connectors` (`type`);
--> statement-breakpoint
CREATE TABLE `connector_status_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`connector_id` text NOT NULL,
	`devchain_status_label` text NOT NULL,
	`external_status_id` text NOT NULL,
	`direction` text DEFAULT 'both' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`connector_id`) REFERENCES `connectors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `connector_status_mappings_connector_id_idx` ON `connector_status_mappings` (`connector_id`);
--> statement-breakpoint
CREATE TABLE `connector_sync_state` (
	`id` text PRIMARY KEY NOT NULL,
	`connector_id` text NOT NULL,
	`epic_id` text NOT NULL,
	`external_id` text NOT NULL,
	`last_synced_at` text NOT NULL,
	`last_synced_hash` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`connector_id`) REFERENCES `connectors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`epic_id`) REFERENCES `epics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connector_sync_state_connector_epic_idx` ON `connector_sync_state` (`connector_id`,`epic_id`);
--> statement-breakpoint
CREATE INDEX `connector_sync_state_connector_external_idx` ON `connector_sync_state` (`connector_id`,`external_id`);
--> statement-breakpoint
CREATE TABLE `connector_field_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`connector_id` text NOT NULL,
	`devchain_field` text NOT NULL,
	`external_field` text NOT NULL,
	`transform` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`connector_id`) REFERENCES `connectors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `connector_field_mappings_connector_id_idx` ON `connector_field_mappings` (`connector_id`);
