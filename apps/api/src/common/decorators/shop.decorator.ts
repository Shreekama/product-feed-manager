import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extracts the shop domain from the request (injected by ShopifyAuthGuard).
 * Usage: @Shop() shopDomain: string
 */
export const Shop = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.shopDomain as string;
  },
);
