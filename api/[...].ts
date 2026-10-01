import type { Request, Response } from 'express';
import { app } from '../server/ytmusic';

export default function handler(req: Request, res: Response) {
  // Vercel's splat rewrite exposes the original API path as `path`.
  const route = (req as any).query?.path;
  if (route) {
    const segments = Array.isArray(route) ? route : String(route).split('/');
    const sourceUrl = new URL(req.url || '/', 'https://wave.invalid');
    sourceUrl.searchParams.delete('path');
    req.url = `/api/${segments.map((part: string) => encodeURIComponent(part)).join('/')}${sourceUrl.search}`;
  }
  return app(req, res);
}
