import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Handler = (req: Request, res: Response) => Promise<unknown>;

/** Adapta um handler async: responde com o retorno em JSON e repassa erros ao Express. */
export const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((body) => {
    if (!res.headersSent) res.json(body ?? { ok: true });
  }, next);
};

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Dados inválidos.');
  return r.data;
}
