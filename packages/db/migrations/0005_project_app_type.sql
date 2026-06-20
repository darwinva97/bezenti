-- App instalada en cada proyecto por el instalador 1-clic (null = PHP en blanco).
ALTER TABLE `projects` ADD COLUMN `app_type` text;
