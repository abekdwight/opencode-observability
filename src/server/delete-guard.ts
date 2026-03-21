export function requireDeleteConfirmation(
  sessionId: string,
  confirmationValue: string | undefined,
) {
  return confirmationValue === sessionId;
}
