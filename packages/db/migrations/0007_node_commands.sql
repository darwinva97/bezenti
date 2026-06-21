-- Historial de comandos ejecutados desde la consola web del admin.
CREATE TABLE `node_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`command` text NOT NULL,
	`exit_code` integer,
	`output` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
