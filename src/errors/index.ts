/* eslint-disable @typescript-eslint/no-explicit-any */
export class AppError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode = 500, cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    (this as any).cause = cause;
  }
}

export class AthleteNotFoundError extends AppError {
  constructor(public readonly athleteId: number) {
    super(`Athlete not found: ${athleteId}`, 404);
    this.name = "AthleteNotFoundError";
  }
}

export class StravaApiError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 502, cause);
    this.name = "StravaApiError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
    this.name = "ValidationError";
  }
}
