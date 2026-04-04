import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * Validates HMAC signature on Shopify webhook requests.
 * Requires the raw request body to be available as request.rawBody (Buffer).
 */
@Injectable()
export class ShopifyHmacGuard implements CanActivate {
  private readonly logger = new Logger(ShopifyHmacGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const hmacHeader = request.headers['x-shopify-hmac-sha256'] as string;
    const rawBody: Buffer = request.rawBody;

    if (!hmacHeader || !rawBody) {
      throw new UnauthorizedException('Missing HMAC or raw body');
    }

    const secret = this.config.get<string>('shopify.apiSecret');
    const computed = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');

    if (computed !== hmacHeader) {
      this.logger.warn('HMAC mismatch on webhook request');
      throw new UnauthorizedException('Invalid webhook HMAC');
    }

    // Inject shop domain from header for downstream use
    request.shopDomain = request.headers['x-shopify-shop-domain'] as string;
    return true;
  }
}
