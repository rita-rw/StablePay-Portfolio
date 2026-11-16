import type { Response } from "express";

/** Minimal Express Response stand-in that records status and JSON body. */
export function mockResponse() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res as typeof res & Response;
}

/** next() stand-in that counts how many times it was called. */
export function mockNext() {
  const next = () => {
    next.calls++;
  };
  next.calls = 0;
  return next;
}
