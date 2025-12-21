export type Request = {
  id: string;
  tool: string;
  input: Record<string, unknown>;
};

export type SuccessResponse = {
  id: string;
  ok: true;
  output: Record<string, unknown>;
};

export type ErrorDetails = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type ErrorResponse = {
  id: string | null;
  ok: false;
  error: ErrorDetails;
};

export type Response = SuccessResponse | ErrorResponse;
