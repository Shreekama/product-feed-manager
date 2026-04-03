import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    // Preserve raw body for webhook HMAC verification
    rawBody: true,
    bufferLogs: true,
  });

  const config = app.get(ConfigService);
  const port = config.get<number>('port', 3001);
  const webUrl = config.get<string>('webUrl', 'http://localhost:3000');

  // Security
  app.use(helmet());
  app.enableCors({
    origin: [webUrl],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // API prefix
  app.setGlobalPrefix('api');

  // Swagger docs (dev only)
  if (config.get('nodeEnv') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Product Feed Manager API')
      .setDescription('Shopify product feed management SaaS')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
    logger.log(`Swagger UI: http://localhost:${port}/api/docs`);
  }

  await app.listen(port);
  logger.log(`API running on http://localhost:${port}`);
}

bootstrap();
