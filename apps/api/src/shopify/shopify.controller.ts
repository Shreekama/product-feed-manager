import { Controller, Get, Post, Query, Body, Res, Logger, HttpCode } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { ShopifyInstallService } from './shopify-install.service';
import { BulkSyncService } from './bulk-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

@ApiTags('shopify')
@Controller('shopify')
export class ShopifyController {
  private readonly logger = new Logger(ShopifyController.name);

  constructor(
    private readonly installService: ShopifyInstallService,
    private readonly bulkSync: BulkSyncService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * OAuth start — redirect to Shopify authorization page.
   */
  @Get('install')
  @ApiOperation({ summary: 'Begin Shopify OAuth install' })
  install(@Query('shop') shop: string, @Res() res: Response) {
    if (!shop) return res.status(400).send('Missing shop parameter');

    const apiKey = this.config.get<string>('shopify.apiKey');
    const scopes = this.config.get<string[]>('shopify.scopes').join(',');
    const redirectUri = `${this.config.get('appUrl')}/api/shopify/callback`;
    const nonce = crypto.randomBytes(16).toString('hex');

    const authUrl =
      `https://${shop}/admin/oauth/authorize` +
      `?client_id=${apiKey}` +
      `&scope=${scopes}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${nonce}`;

    return res.redirect(authUrl);
  }

  /**
   * OAuth callback — exchange code for access token.
   */
  @Get('callback')
  @ApiOperation({ summary: 'Handle Shopify OAuth callback' })
  async callback(
    @Query('shop') shop: string,
    @Query('code') code: string,
    @Query('hmac') hmac: string,
    @Query() allParams: Record<string, string>,
    @Res() res: Response,
  ) {
    // Validate HMAC
    const secret = this.config.get<string>('shopify.apiSecret');
    const { hmac: _hmac, ...rest } = allParams;
    const message = Object.keys(rest)
      .sort()
      .map((k) => `${k}=${rest[k]}`)
      .join('&');
    const computed = crypto.createHmac('sha256', secret).update(message).digest('hex');

    if (computed !== hmac) {
      return res.status(401).send('Invalid HMAC');
    }

    // Exchange code for token
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.config.get('shopify.apiKey'),
        client_secret: secret,
        code,
      }),
    });

    const { access_token } = await tokenRes.json() as any;
    if (!access_token) return res.status(400).send('Token exchange failed');

    const storeId = await this.installService.handleInstall(shop, access_token);

    // Trigger async bulk sync
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    this.bulkSync
      .runFullSync(shop, access_token, storeId)
      .catch((err) => this.logger.error(`Bulk sync error: ${err.message}`));

    const webUrl = this.config.get<string>('webUrl');
    return res.redirect(`${webUrl}?shop=${shop}&installed=true`);
  }

  /**
   * Manually trigger a full re-sync for a store.
   */
  @Post('sync')
  @HttpCode(202)
  @ApiOperation({ summary: 'Trigger full product sync for a store' })
  async triggerSync(@Body('shopDomain') shopDomain: string) {
    const store = await this.prisma.store.findUniqueOrThrow({
      where: { shopDomain },
      select: { id: true, accessToken: true, syncStatus: true },
    });

    if (store.syncStatus === 'SYNCING') {
      return { message: 'Sync already in progress' };
    }

    this.bulkSync
      .runFullSync(shopDomain, store.accessToken, store.id)
      .catch((err) => this.logger.error(`Manual sync error: ${err.message}`));

    return { message: 'Sync started', storeId: store.id };
  }
}
