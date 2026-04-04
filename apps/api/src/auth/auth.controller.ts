import { Controller, Get, Query, Res, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { google } from 'googleapis';

/**
 * Google OAuth flow for Sheets integration.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private getOAuthClient() {
    return new google.auth.OAuth2(
      this.config.get('google.clientId'),
      this.config.get('google.clientSecret'),
      this.config.get('google.redirectUri'),
    );
  }

  @Get('google')
  @ApiOperation({ summary: 'Start Google OAuth flow' })
  startGoogleOAuth(
    @Query('shop') shopDomain: string,
    @Res() res: Response,
  ) {
    const oauth2 = this.getOAuthClient();
    const url = oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/spreadsheets'],
      state: shopDomain,
    });
    return res.redirect(url);
  }

  @Get('google/callback')
  @ApiOperation({ summary: 'Handle Google OAuth callback' })
  async googleCallback(
    @Query('code') code: string,
    @Query('state') shopDomain: string,
    @Res() res: Response,
  ) {
    const oauth2 = this.getOAuthClient();
    const { tokens } = await oauth2.getToken(code);

    const store = await this.prisma.store.findUnique({
      where: { shopDomain },
      select: { id: true },
    });

    if (!store) {
      return res.status(400).send('Store not found');
    }

    await this.prisma.googleToken.upsert({
      where: { storeId: store.id },
      create: {
        storeId: store.id,
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token!,
        expiresAt: new Date(tokens.expiry_date || Date.now() + 3600_000),
        scope: tokens.scope || '',
      },
      update: {
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token || undefined,
        expiresAt: new Date(tokens.expiry_date || Date.now() + 3600_000),
        scope: tokens.scope || '',
      },
    });

    const webUrl = this.config.get<string>('webUrl');
    return res.redirect(`${webUrl}/settings?google_connected=true&shop=${shopDomain}`);
  }
}
