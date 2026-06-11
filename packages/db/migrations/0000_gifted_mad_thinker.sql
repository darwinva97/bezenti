CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`impersonated_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`role` text DEFAULT 'user',
	`banned` integer DEFAULT false,
	`ban_reason` text,
	`ban_expires` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`price_pen` real NOT NULL,
	`price_usd` real,
	`disk_mb` integer NOT NULL,
	`ram_mb_soft` integer NOT NULL,
	`max_domains` integer NOT NULL,
	`max_databases` integer NOT NULL,
	`php_versions` text DEFAULT '["8.3"]' NOT NULL,
	`php_memory_limit_mb` integer DEFAULT 128 NOT NULL,
	`php_max_processes` integer DEFAULT 5 NOT NULL,
	`bandwidth_gb_month` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`region` text,
	`ip_public` text NOT NULL,
	`agent_url` text NOT NULL,
	`agent_token_hash` text NOT NULL,
	`status` text DEFAULT 'provisioning' NOT NULL,
	`disk_gb_total` integer,
	`ram_mb_total` integer,
	`created_at` integer NOT NULL,
	`last_heartbeat_at` integer
);
--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`node_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`linux_user` text NOT NULL,
	`sftp_password_hash` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`suspension_reason` text,
	`created_at` integer NOT NULL,
	`suspended_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_user_id_unique` ON `clients` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `clients_linux_user_unique` ON `clients` (`linux_user`);--> statement-breakpoint
CREATE TABLE `storage_quotas` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`mode` text DEFAULT 'shared' NOT NULL,
	`total_mb` integer,
	`files_mb` integer,
	`mysql_mb` integer,
	`postgresql_mb` integer,
	`email_mb` integer,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storage_quotas_client_id_unique` ON `storage_quotas` (`client_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`domain` text NOT NULL,
	`php_version` text DEFAULT '8.3' NOT NULL,
	`doc_path` text NOT NULL,
	`cloudflare_dns_id` text,
	`ssl_status` text DEFAULT 'pending' NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_domain_unique` ON `projects` (`domain`);--> statement-breakpoint
CREATE TABLE `client_databases` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`project_id` text,
	`engine` text DEFAULT 'mysql' NOT NULL,
	`db_name` text NOT NULL,
	`db_user` text NOT NULL,
	`db_password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_databases_db_name_unique` ON `client_databases` (`db_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `client_databases_db_user_unique` ON `client_databases` (`db_user`);--> statement-breakpoint
CREATE TABLE `email_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`email` text NOT NULL,
	`stalwart_id` text,
	`quota_mb` integer DEFAULT 1024 NOT NULL,
	`used_mb` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_accounts_email_unique` ON `email_accounts` (`email`);--> statement-breakpoint
CREATE TABLE `dns_records` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`value` text NOT NULL,
	`ttl` integer DEFAULT 3600 NOT NULL,
	`priority` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`zone_id`) REFERENCES `dns_zones`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `dns_zones` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`zone` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dns_zones_zone_unique` ON `dns_zones` (`zone`);--> statement-breakpoint
CREATE TABLE `client_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` text NOT NULL,
	`recorded_at` integer NOT NULL,
	`disk_used_mb` integer DEFAULT 0 NOT NULL,
	`mysql_used_mb` integer DEFAULT 0 NOT NULL,
	`pg_used_mb` integer DEFAULT 0 NOT NULL,
	`email_used_mb` integer DEFAULT 0 NOT NULL,
	`process_count` integer DEFAULT 0 NOT NULL,
	`requests_today` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `node_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`node_id` text NOT NULL,
	`recorded_at` integer NOT NULL,
	`cpu_pct` real,
	`ram_used_mb` integer,
	`disk_used_gb` real,
	`clients_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
