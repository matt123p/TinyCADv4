export class ModelOutputLimitError extends Error {
  readonly code = 'model_output_limit';
  constructor(
    message = 'The model reached its output limit before finishing the reply.',
  ) {
    super(message);
    this.name = 'ModelOutputLimitError';
  }
}
export function isModelOutputLimit(
  error: unknown,
): error is ModelOutputLimitError {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'model_output_limit'
  );
}
