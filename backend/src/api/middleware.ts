import type { Request, Response, NextFunction } from 'express';
import type { AuthService } from '../services/auth.js';

declare global {
  namespace Express {
    interface Request {
      isAdmin?: boolean;
    }
  }
}

export function adminAuth(auth: AuthService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const payload = auth.verifyToken(token);
    if (!payload) {
      res.status(401).json({ error: '未授权或凭证已过期' });
      return;
    }
    req.isAdmin = true;
    next();
  };
}
