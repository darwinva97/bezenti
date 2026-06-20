-- Cuentas de proveedor cloud para aprovisionar VPS por API (Hetzner + custom).
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`api_token` text NOT NULL,
	`config` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `nodes` ADD COLUMN `provider_id` text;--> statement-breakpoint
ALTER TABLE `nodes` ADD COLUMN `external_id` text;
