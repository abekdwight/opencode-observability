type MessageDataExpression = "data" | "m.data";

export function buildMessageTotalTokensSql(
  dataExpression: MessageDataExpression,
): string {
  return `COALESCE(
  NULLIF(json_extract(${dataExpression}, '$.tokens.total'), 0),
  COALESCE(json_extract(${dataExpression}, '$.tokens.input'), 0)
    + COALESCE(json_extract(${dataExpression}, '$.tokens.output'), 0)
    + COALESCE(json_extract(${dataExpression}, '$.tokens.cache.read'), 0)
    + COALESCE(json_extract(${dataExpression}, '$.tokens.cache.write'), 0),
  0
)`;
}
