// SPDX-License-Identifier: MIT
// Copyright (c) 2026 caxton strange

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { StorageService } from './storage.service';
import { FileMetadata } from './file-metadata.entity';
import { StorageController } from './storage.controller';
import { ImageProcessingService } from './image-processing.service';
import { VideoProcessingService } from './video-processing.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FileMetadata]),
    BullModule.registerQueue({ name: 'video-processing' }),
  ],
  providers: [StorageService, ImageProcessingService, VideoProcessingService],
  controllers: [StorageController],
  exports: [StorageService, ImageProcessingService, VideoProcessingService],
})
export class StorageModule {}
