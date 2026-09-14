// Model generation throughput: tokens the model emitted per second of
// generation. Reasoning tokens count; tool-execution time does not.
export function calcModelTps(
  outputTokens: number,
  reasoningTokens: number,
  generationMs: number,
): number | null {
  if (
    !Number.isFinite(outputTokens) ||
    !Number.isFinite(reasoningTokens) ||
    !Number.isFinite(generationMs)
  ) {
    return null;
  }
  const generatedTokens = outputTokens + reasoningTokens;
  if (generatedTokens <= 0 || generationMs <= 0) return null;
  return (generatedTokens * 1000) / generationMs;
}
