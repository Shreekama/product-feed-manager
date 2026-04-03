import {
  IsString,
  IsEnum,
  IsOptional,
  IsArray,
  ValidateNested,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum Platform {
  GOOGLE = 'GOOGLE',
  FACEBOOK = 'FACEBOOK',
  PINTEREST = 'PINTEREST',
}

export enum OutputType {
  GOOGLE_SHEETS = 'GOOGLE_SHEETS',
  CSV = 'CSV',
  XML = 'XML',
}

export class ColumnMappingDto {
  @ApiProperty({ description: 'Feed column name (e.g. "title", "g:price")' })
  @IsString() @IsNotEmpty()
  feedColumn: string;

  @ApiProperty({ enum: ['product', 'variant', 'metafield', 'computed'] })
  @IsEnum(['product', 'variant', 'metafield', 'computed'])
  sourceType: 'product' | 'variant' | 'metafield' | 'computed';

  @ApiProperty({ description: 'Field key (e.g. "title", "sku", "custom.size", "image_url")' })
  @IsString() @IsNotEmpty()
  sourceKey: string;

  @ApiPropertyOptional({ description: 'Optional value transform (e.g. "uppercase", "append:USD")' })
  @IsOptional() @IsString()
  transform?: string;
}

export class FilterRuleDto {
  @IsString() @IsNotEmpty() field: string;
  @IsString() @IsNotEmpty() operator: string; // eq, neq, gt, lt, contains, in
  @IsString() value: string;
}

export class ScheduleDto {
  @ApiProperty({ description: 'Cron expression, e.g. "0 */6 * * *"' })
  @IsString() @IsNotEmpty()
  cronExpr: string;

  @ApiPropertyOptional({ default: 'UTC' })
  @IsOptional() @IsString()
  timezone?: string;
}

export class CreateFeedDto {
  @ApiProperty() @IsString() @IsNotEmpty()
  name: string;

  @ApiProperty({ enum: Platform })
  @IsEnum(Platform)
  platform: Platform;

  @ApiPropertyOptional({ default: 'US' })
  @IsOptional() @IsString()
  country?: string;

  @ApiProperty({ enum: OutputType })
  @IsEnum(OutputType)
  outputType: OutputType;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  googleSheetId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  googleSheetTab?: string;

  @ApiPropertyOptional({ type: [ColumnMappingDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ColumnMappingDto)
  columnMappings?: ColumnMappingDto[];

  @ApiPropertyOptional({ type: [FilterRuleDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => FilterRuleDto)
  filterRules?: FilterRuleDto[];

  @ApiPropertyOptional()
  @IsOptional() @ValidateNested() @Type(() => ScheduleDto)
  schedule?: ScheduleDto;
}
