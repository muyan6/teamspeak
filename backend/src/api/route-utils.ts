import type { NextFunction, Request, Response } from 'express';

export type AsyncHandler = (req: Request, res: Response) => Promise<void>;

export function asyncRoute(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}
