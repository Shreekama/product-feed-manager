import { IsOptional, IsString, IsBoolean, IsNumber, Min, Max } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryProductsDto {
  @ApiPropertyOptional() @IsOptional() @IsString()
  search?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  vendor?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  collection?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter products excluded from feeds' })
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  excludeFromFeeds?: boolean;

  @ApiPropertyOptional({ description: 'Filter products with any stock' })
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  inStock?: boolean;

  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(200)
  limit?: number = 50;
}
