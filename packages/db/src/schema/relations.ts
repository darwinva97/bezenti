import { relations } from "drizzle-orm";
import { user, session, account } from "./auth";
import { clients, storageQuotas } from "./clients";
import { nodes } from "./nodes";
import { plans } from "./plans";
import { projects } from "./projects";
import { clientDatabases } from "./databases";
import { emailAccounts } from "./email";
import { dnsZones, dnsRecords } from "./dns";
import { nodeMetrics, clientMetrics } from "./metrics";

// ── auth ────────────────────────────────────────────────────────────────────

export const userRelations = relations(user, ({ one, many }) => ({
  client:   one(clients, { fields: [user.id], references: [clients.userId] }),
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

// ── nodes ───────────────────────────────────────────────────────────────────

export const nodeRelations = relations(nodes, ({ many }) => ({
  clients:     many(clients),
  nodeMetrics: many(nodeMetrics),
}));

// ── plans ───────────────────────────────────────────────────────────────────

export const planRelations = relations(plans, ({ many }) => ({
  clients: many(clients),
}));

// ── clients ─────────────────────────────────────────────────────────────────

export const clientRelations = relations(clients, ({ one, many }) => ({
  user:          one(user,          { fields: [clients.userId], references: [user.id] }),
  node:          one(nodes,         { fields: [clients.nodeId], references: [nodes.id] }),
  plan:          one(plans,         { fields: [clients.planId], references: [plans.id] }),
  storageQuota:  one(storageQuotas, { fields: [clients.id],     references: [storageQuotas.clientId] }),
  projects:      many(projects),
  databases:     many(clientDatabases),
  emailAccounts: many(emailAccounts),
  dnsZones:      many(dnsZones),
  clientMetrics: many(clientMetrics),
}));

export const storageQuotaRelations = relations(storageQuotas, ({ one }) => ({
  client: one(clients, { fields: [storageQuotas.clientId], references: [clients.id] }),
}));

// ── projects ────────────────────────────────────────────────────────────────

export const projectRelations = relations(projects, ({ one, many }) => ({
  client:    one(clients, { fields: [projects.clientId], references: [clients.id] }),
  databases: many(clientDatabases),
}));

// ── databases ───────────────────────────────────────────────────────────────

export const clientDatabaseRelations = relations(clientDatabases, ({ one }) => ({
  client:  one(clients,  { fields: [clientDatabases.clientId],  references: [clients.id] }),
  project: one(projects, { fields: [clientDatabases.projectId], references: [projects.id] }),
}));

// ── email ───────────────────────────────────────────────────────────────────

export const emailAccountRelations = relations(emailAccounts, ({ one }) => ({
  client: one(clients, { fields: [emailAccounts.clientId], references: [clients.id] }),
}));

// ── dns ─────────────────────────────────────────────────────────────────────

export const dnsZoneRelations = relations(dnsZones, ({ one, many }) => ({
  client:  one(clients,    { fields: [dnsZones.clientId], references: [clients.id] }),
  records: many(dnsRecords),
}));

export const dnsRecordRelations = relations(dnsRecords, ({ one }) => ({
  zone: one(dnsZones, { fields: [dnsRecords.zoneId], references: [dnsZones.id] }),
}));

// ── metrics ─────────────────────────────────────────────────────────────────

export const nodeMetricRelations = relations(nodeMetrics, ({ one }) => ({
  node: one(nodes, { fields: [nodeMetrics.nodeId], references: [nodes.id] }),
}));

export const clientMetricRelations = relations(clientMetrics, ({ one }) => ({
  client: one(clients, { fields: [clientMetrics.clientId], references: [clients.id] }),
}));
