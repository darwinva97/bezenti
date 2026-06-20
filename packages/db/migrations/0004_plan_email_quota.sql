-- Límite de cuentas de correo por plan (para mostrar "X de Y correos" y aplicarlo).
ALTER TABLE `plans` ADD COLUMN `max_email_accounts` integer NOT NULL DEFAULT 5;
