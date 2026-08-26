// SPDX-License-Identifier: MIT
// Copyright (c) 2026 caxton strange

import {
  Controller,
  Get,
  Post,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import {
  DataRetentionService,
  DataRetentionStats,
} from './data-retention.service';

@ApiTags('Data Retention')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('data-retention')
export class DataRetentionController {
  constructor(private readonly dataRetentionService: DataRetentionService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get data retention policy status' })
  @ApiResponse({
    status: 200,
    description: 'Retention statistics retrieved successfully',
  })
  async getStats() {
    return this.dataRetentionService.getRetentionStats();
  }

  @Post('trigger')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manually trigger retention enforcement (erasure + cleanup)',
  })
  @ApiResponse({
    status: 200,
    description: 'Retention enforcement completed successfully',
  })
  async trigger(): Promise<DataRetentionStats> {
    return this.dataRetentionService.enforceRetention();
  }
}
