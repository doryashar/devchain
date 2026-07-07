ALTER TABLE `epics` ADD `assignment_delivered_at` text;--> statement-breakpoint
CREATE INDEX `epics_agent_delivery_idx` ON `epics` (`agent_id`,`assignment_delivered_at`);--> statement-breakpoint
-- Backfill: every currently-assigned epic is treated as already delivered so the
-- per-agent one-at-a-time gate only affects NEW assignments going forward.
UPDATE `epics` SET `assignment_delivered_at` = datetime('now') WHERE `agent_id` IS NOT NULL;