import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import * as crypto from 'crypto';

/**
 * Validates Shopify session tokens (JWT) sent in Authorization header.
 * For webhook routes, use ShopifyHmacGuard instead.
 */
@Injectable()
export class ShopifyAuthGuard implements CanActivate {
  private readonly logger = new Logger(ShopifyAuthGuard.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'] as string;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing authorization token');
    }

    const token = authHeader.slice(7);

    try {
      // Decode JWT payload (Shopify session token)
      const [, payloadB64] = token.split('.');
      const payload = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf-8'),
      );

      const shopDomain = payload.dest?.replace('https://', '');
      if (!shopDomain) throw new Error('No shop in token');

      // Verify token signature using Shopify API secret
      const apiSecret = this.config.get<string>('shopify.apiSecret');
      const [headerB64, payloadB64Raw, signatureB64] = token.split('.');
      const signingInput = `${headerB64}.${payloadB64Raw}`;
      const expectedSig = crypto
        .createHmac('sha256', apiSecret)
        .update(signingInput)
        .digest('base64url');

      if (expectedSig !== signatureB64) {
        throw new Error('Invalid token signature');
      }

      // Confirm store exists
      const store = await this.prisma.store.findUnique({
        where: { shopDomain },
        select: { id: true, shopDomain: true },
      });

      if (!store) throw new Error('Store not found');

      request.shopDomain = shopDomain;
      request.storeId = store.id;
      return true;
    } catch (err) {
      this.logger.warn(`Auth failed: ${err.message}`);
      throw new UnauthorizedException('Invalid session token');
    }
  }
}
