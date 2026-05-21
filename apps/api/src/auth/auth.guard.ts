import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  ForbiddenException,
  createParamDecorator,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { UserRole } from '@adas/shared';

/**
 * Authentication & authorization.
 *
 * In production the principal is resolved from a verified Clerk session token (JWT). Here
 * the AuthGuard shows the contract: it attaches a typed principal to the request, and every
 * downstream query is scoped by principal.organizationId. The RolesGuard enforces RBAC.
 *
 * SECURITY INVARIANT: organizationId is ALWAYS taken from the principal, never from the
 * request body/params. This is what prevents cross-tenant data access.
 */

export interface Principal {
  userId: string;
  organizationId: string;
  role: UserRole;
  email: string;
}

declare module 'express' {
  interface Request {
    principal?: Principal;
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  // Injected verifier (Clerk/Auth0). Abstracted so tests use a stub.
  constructor(private readonly verifier: TokenVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length);
    const principal = await this.verifier.verify(token);
    if (!principal) throw new UnauthorizedException('Invalid token');
    req.principal = principal;
    return true;
  }
}

export interface TokenVerifier {
  verify(token: string): Promise<Principal | null>;
}

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const principal: Principal | undefined = req.principal;
    if (!principal) throw new UnauthorizedException();
    if (!required.includes(principal.role)) {
      throw new ForbiddenException(`Requires one of: ${required.join(', ')}`);
    }
    return true;
  }
}

/** @CurrentUser() — inject the typed principal into a handler. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal => {
    const req = ctx.switchToHttp().getRequest();
    if (!req.principal) throw new UnauthorizedException();
    return req.principal;
  },
);
