ALTER TABLE `dns_zones` ADD COLUMN `ns1` text;--> statement-breakpoint
ALTER TABLE `dns_zones` ADD COLUMN `ns2` text;--> statement-breakpoint
ALTER TABLE `dns_zones` ADD COLUMN `status` text NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `dns_zones` ADD COLUMN `verified_at` integer;
