-- El control plane necesita el token en claro para autenticarse contra el
-- agente del nodo (X-Agent-Token). El hash se mantiene para validar heartbeats.
ALTER TABLE `nodes` ADD COLUMN `agent_token` text;
