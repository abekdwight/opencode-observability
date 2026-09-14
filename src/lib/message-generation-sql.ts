type MessageDataExpression = "data" | "m.data";

export function buildMessageDurationMsSql(
  dataExpression: MessageDataExpression,
): string {
  return `CASE
    WHEN json_extract(${dataExpression}, '$.time.created') IS NOT NULL
     AND json_extract(${dataExpression}, '$.time.completed') IS NOT NULL
     AND json_extract(${dataExpression}, '$.time.completed') > json_extract(${dataExpression}, '$.time.created')
    THEN json_extract(${dataExpression}, '$.time.completed') - json_extract(${dataExpression}, '$.time.created')
    ELSE 0
  END`;
}

// Generation duration for model TPS.
// Prefer the summed text/reasoning part intervals (excludes tool execution and
// the gaps between them). If those parts have no timestamps, fall back to
// message wall-clock minus summed tool-part intervals.
export function buildGenerationMsSql(
  dataExpression: MessageDataExpression,
): string {
  const messageIdExpression =
    dataExpression === "m.data" ? "m.id" : "message.id";
  const messageDurationSql = buildMessageDurationMsSql(dataExpression);
  return `(
    SELECT
      CASE
        WHEN generation.generation_ms > 0 THEN generation.generation_ms
        ELSE MAX(0, (${messageDurationSql}) - generation.tool_ms)
      END
    FROM (
      SELECT
        COALESCE(SUM(
          CASE
            WHEN json_extract(part.data, '$.type') IN ('text', 'reasoning')
             AND json_extract(part.data, '$.time.end') > json_extract(part.data, '$.time.start')
            THEN json_extract(part.data, '$.time.end') - json_extract(part.data, '$.time.start')
            ELSE 0
          END
        ), 0) AS generation_ms,
        COALESCE(SUM(
          CASE
            WHEN json_extract(part.data, '$.type') = 'tool'
             AND json_extract(part.data, '$.state.time.end') > json_extract(part.data, '$.state.time.start')
            THEN json_extract(part.data, '$.state.time.end') - json_extract(part.data, '$.state.time.start')
            ELSE 0
          END
        ), 0) AS tool_ms
      FROM part
      WHERE part.message_id = ${messageIdExpression}
    ) AS generation
  )`;
}
