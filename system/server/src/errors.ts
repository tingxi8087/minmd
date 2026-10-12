export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly conflict?: {
      currentRevision: number;
      currentEpoch: number;
    },
  ) {
    super(message);
    this.name = "AppError";
  }
}
