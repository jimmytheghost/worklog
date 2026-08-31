import { z } from "zod";

import {
  ATTRIBUTIONS,
  COMPLETENESS_LEVELS,
  CONFIDENCE_LEVELS,
  EVENT_TYPES,
  FRESHNESS_LEVELS,
  METRIC_UNITS,
  OCCURRED_AT_SOURCES,
  SOURCE_SYSTEMS,
  type AnyNormalizedEvent,
  type EventPayloads,
  type EventType,
  type MetricResult,
} from "./types.js";

const nonEmptyString = z.string().min(1);
const instant = z.iso.datetime({ offset: true });
const sha = z.string().regex(/^[0-9a-fA-F]{40,64}$/).transform((value) => value.toLowerCase());
const tokenCount = z.number().int().nonnegative();

export const attributionSchema = z.enum(ATTRIBUTIONS);
export const confidenceSchema = z.enum(CONFIDENCE_LEVELS);
export const completenessSchema = z.enum(COMPLETENESS_LEVELS);
export const freshnessSchema = z.enum(FRESHNESS_LEVELS);
export const sourceSystemSchema = z.enum(SOURCE_SYSTEMS);
export const eventTypeSchema = z.enum(EVENT_TYPES);

const associationPayloadSchema = z.strictObject({
  fromEntityType: nonEmptyString,
  fromEntityId: nonEmptyString,
  toEntityType: nonEmptyString,
  toEntityId: nonEmptyString,
  method: nonEmptyString,
  reason: nonEmptyString.optional(),
});

export const eventPayloadSchemas = {
  "git.commit.discovered": z.strictObject({
    sha,
    authorOccurredAt: instant.optional(),
    committerOccurredAt: instant,
    parentShas: z.array(sha),
  }),
  "github.push.observed": z.strictObject({
    ref: nonEmptyString,
    beforeSha: sha.optional(),
    afterSha: sha.optional(),
    commitShas: z.array(sha),
    membershipComplete: z.boolean(),
    forced: z.boolean().optional(),
    deleted: z.boolean().optional(),
  }),
  "git.ref.snapshot_observed": z.strictObject({
    ref: nonEmptyString,
    sha: sha.optional(),
    deleted: z.boolean().optional(),
  }),
  "repository.discovered": z.strictObject({
    repositoryKey: nonEmptyString,
    name: nonEmptyString,
    owner: nonEmptyString.optional(),
    visibility: z.enum(["public", "private", "internal", "unknown"]).optional(),
  }),
  "repository.metadata_changed": z.strictObject({
    changedFields: z.array(nonEmptyString).min(1),
  }),
  "codex.task.started": z.strictObject({
    sourceTaskId: nonEmptyString,
    workspacePathHash: nonEmptyString.optional(),
  }),
  "codex.session.started": z.strictObject({
    sourceSessionId: nonEmptyString,
    model: nonEmptyString.optional(),
  }),
  "codex.subagent.spawned": z.strictObject({
    parentSessionId: nonEmptyString,
    childSessionId: nonEmptyString,
  }),
  "codex.session.completed": z.strictObject({
    outcome: z.enum(["completed", "failed", "cancelled", "interrupted", "unknown"]),
    durationMilliseconds: z.number().int().nonnegative().optional(),
  }),
  "codex.usage.recorded": z.strictObject({
    inputTokens: tokenCount.optional(),
    outputTokens: tokenCount.optional(),
    cachedTokens: tokenCount.optional(),
    reasoningTokens: tokenCount.optional(),
    bucketStart: instant.optional(),
    bucketEnd: instant.optional(),
  }),
  "openai.api_usage.recorded": z.strictObject({
    inputTokens: tokenCount.optional(),
    outputTokens: tokenCount.optional(),
    cachedTokens: tokenCount.optional(),
    bucketStart: instant,
    bucketEnd: instant,
    dimensions: z.record(z.string(), z.string()),
  }),
  "openai.api_cost.recorded": z.strictObject({
    amount: z.number().finite().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    bucketStart: instant,
    bucketEnd: instant,
    dimensions: z.record(z.string(), z.string()),
  }),
  "association.recorded": associationPayloadSchema,
  "association.corrected": associationPayloadSchema.extend({
    supersedesAssociationId: nonEmptyString,
  }),
} satisfies { [T in EventType]: z.ZodType<EventPayloads[T]> };

const eventBaseShape = {
  eventId: nonEmptyString,
  schemaVersion: z.number().int().positive(),
  entityType: nonEmptyString,
  entityId: nonEmptyString,
  repositoryId: nonEmptyString.optional(),
  taskId: nonEmptyString.optional(),
  sessionId: nonEmptyString.optional(),
  occurredAt: instant,
  occurredAtSource: z.enum(OCCURRED_AT_SOURCES),
  observedAt: instant,
  sourceSystem: sourceSystemSchema,
  sourceAccountId: nonEmptyString,
  sourceRecordId: nonEmptyString,
  adapterName: nonEmptyString,
  adapterVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  sourceFormatVersion: nonEmptyString.optional(),
  idempotencyKey: nonEmptyString,
  attribution: attributionSchema,
  confidence: confidenceSchema,
  completeness: completenessSchema,
  rawRecordHash: nonEmptyString.optional(),
};

const eventSchemas = EVENT_TYPES.map((eventType) =>
  z.strictObject({
    ...eventBaseShape,
    eventType: z.literal(eventType),
    payload: eventPayloadSchemas[eventType],
  }),
);

export const normalizedEventSchema = z.discriminatedUnion("eventType", [
  eventSchemas[0]!,
  eventSchemas[1]!,
  eventSchemas[2]!,
  eventSchemas[3]!,
  eventSchemas[4]!,
  eventSchemas[5]!,
  eventSchemas[6]!,
  eventSchemas[7]!,
  eventSchemas[8]!,
  eventSchemas[9]!,
  eventSchemas[10]!,
  eventSchemas[11]!,
  eventSchemas[12]!,
  eventSchemas[13]!,
]) as z.ZodType<AnyNormalizedEvent>;

export const metricResultSchema = z
  .strictObject({
    metric: nonEmptyString,
    value: z.number().finite().nonnegative().nullable(),
    unit: z.enum(METRIC_UNITS),
    interval: z.strictObject({
      start: instant,
      end: instant,
      timezone: nonEmptyString,
    }),
    dimensions: z.record(z.string(), z.string()),
    sourceSystems: z.array(sourceSystemSchema),
    completeness: completenessSchema,
    coverageStart: instant.optional(),
    coverageEnd: instant.optional(),
    coverageReason: nonEmptyString.optional(),
    lastSucceededAt: instant.optional(),
    freshness: freshnessSchema,
  })
  .superRefine((result, context) => {
    if (result.completeness === "unavailable" && result.value !== null) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Unavailable metrics must have a null value",
      });
    }

    if (result.value === null && !["unavailable", "unknown"].includes(result.completeness)) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Null means unavailable or unknown; covered metrics use a numeric value, including zero",
      });
    }

    if (Date.parse(result.interval.end) <= Date.parse(result.interval.start)) {
      context.addIssue({
        code: "custom",
        path: ["interval", "end"],
        message: "Metric intervals must be non-empty and half-open",
      });
    }
  }) as z.ZodType<MetricResult>;

export function parseNormalizedEvent(input: unknown): AnyNormalizedEvent {
  return normalizedEventSchema.parse(input);
}

export function parseMetricResult(input: unknown): MetricResult {
  return metricResultSchema.parse(input);
}
