-- Subdominios Bezenti por proyecto: <subdomain>--<account_slug>.pages.bezenti.com
ALTER TABLE `clients` ADD COLUMN `account_slug` text;--> statement-breakpoint
CREATE UNIQUE INDEX `clients_account_slug_unique` ON `clients` (`account_slug`);--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `subdomain` text;
