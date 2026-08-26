// SPDX-License-Identifier: MIT
// Copyright (c) 2026 caxton strange

import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { StorageService } from '../../storage/storage.service';
import {
  VideoProcessingService,
  VideoProcessingJobData,
} from '../../storage/video-processing.service';
import { requestContext } from '../../../common/request-context/request-context';

@Processor('video-processing')
export class VideoQueueProcessor {
  private readonly logger = new Logger(VideoQueueProcessor.name);

  constructor(
    private readonly storageService: StorageService,
    private readonly videoProcessing: VideoProcessingService,
  ) {}

  @Process()
  async handleVideoJob(job: Job<VideoProcessingJobData>): Promise<void> {
    const { key, correlationId, requestId } = job.data;

    return requestContext.run(
      { correlationId, requestId, userId: job.data.ownerId },
      async () => {
        this.logger.log(`Transcoding video ${key} (job ${job.id})`);

        try {
          const buffer = await this.storageService.getObjectBuffer(key);
          const variantResults = await this.videoProcessing.transcodeVideo(
            buffer,
            key,
          );

          const variantUrls: Record<string, string> = {};
          for (const [quality, variant] of Object.entries(variantResults)) {
            variantUrls[quality] = await this.storageService.uploadFile(
              variant.key,
              variant.buffer,
              variant.contentType,
            );
          }

          await this.storageService.updateProcessingResult(
            key,
            variantUrls,
            'completed',
          );

          this.logger.log(
            `Video job ${job.id} completed: ${Object.keys(variantUrls).length} quality tier(s) for ${key}`,
          );
        } catch (error) {
          this.logger.error(
            `Video job ${job.id} failed for ${key}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            error instanceof Error ? error.stack : '',
          );
          await this.storageService.updateProcessingResult(key, {}, 'failed');
          throw error;
        }
      },
    );
  }
}
