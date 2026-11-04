import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

export const PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * This is a one-person app, so a single long secret (DASHBOARD_TOKEN)
 * is enough. Send it as the "x-api-token" header.
 */
@Injectable()
export class TokenGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const expected = process.env.DASHBOARD_TOKEN;
    if (!expected || expected.length < 16) {
      throw new UnauthorizedException('Server has no DASHBOARD_TOKEN (min 16 chars) set');
    }
    const req = ctx.switchToHttp().getRequest<Request>();
    const got = String(req.headers['x-api-token'] ?? '');
    const a = Buffer.from(got);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException('Bad token');
    return true;
  }
}
