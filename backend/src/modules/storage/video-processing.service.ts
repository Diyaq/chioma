// SPDX-License-Identifier: MIT
// Copyright (c) 2026 caxton strange

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import ffmpegPath = require('ffmpeg-static');
import ffmpeg = require('fluent-ffmpeg');

export interface VideoVariant {
  key: string;
  buffer: Buffer;
  contentType: string;
  size: number;
}

export interface VideoProcessingJobData {
  key: string;
  ownerId: string;
  contentType: string;
  correlationId?: string;
  requestId?: string;
}

interface QualityPreset {
  name: string;
  height: number;
  videoBitrate: string;
  audioBitrate: string;
}

/** Quality tiers to transcode into, largest first. Upscaling is never done. */
const QUALITY_PRESETS: QualityPreset[] = [
  { name: '1080p', height: 1080, videoBitrate: '5000k', audioBitrate: '192k' },
  { name: '720p', height: 720, videoBitrate: '2800k', audioBitrate: '128k' },
  { name: '480p', height: 480, videoBitrate: '1400k', audioBitrate: '128k' },
  { name: '360p', height: 360, videoBitrate: '800k', audioBitrate: '96k' },
];

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

@Injectable()
export class VideoProcessingService {
  private readonly logger = new Logger(VideoProcessingService.name);

  /**
   * Transcodes a source video into every quality tier at or below its
   * native resolution (never upscales). Returns an empty map if the source
   * is smaller than the lowest tier — the original is kept as-is.
   */
  async transcodeVideo(
    buffer: Buffer,
    originalKey: string,
  ): Promise<Record<string, VideoVariant>> {
    const baseKey = originalKey.replace(/\.[^.]+$/, '');
    const workDir = await mkdtemp(join(tmpdir(), 'video-transcode-'));
    const inputPath = join(workDir, `input-${randomUUID()}`);

    try {
      await writeFile(inputPath, buffer);
      const sourceHeight = await this.probeHeight(inputPath);
      const presets = QUALITY_PRESETS.filter((p) => p.height <= sourceHeight);

      if (presets.length === 0) {
        this.logger.debug(
          `Source height ${sourceHeight}px is below the lowest quality tier; skipping transcode for ${originalKey}`,
        );
        return {};
      }

      const results = await Promise.all(
        presets.map((preset) =>
          this.transcodeOne(inputPath, workDir, preset, baseKey),
        ),
      );

      return Object.fromEntries(
        presets.map((preset, i) => [preset.name, results[i]]),
      );
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private probeHeight(inputPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) return reject(err);
        const videoStream = metadata.streams.find(
          (s) => s.codec_type === 'video',
        );
        resolve(videoStream?.height ?? 0);
      });
    });
  }

  private async transcodeOne(
    inputPath: string,
    workDir: string,
    preset: QualityPreset,
    baseKey: string,
  ): Promise<VideoVariant> {
    const outputPath = join(workDir, `${preset.name}-${randomUUID()}.mp4`);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .videoBitrate(preset.videoBitrate)
        .audioBitrate(preset.audioBitrate)
        .outputOptions([`-vf scale=-2:${preset.height}`])
        .format('mp4')
        .on('error', reject)
        .on('end', () => resolve())
        .save(outputPath);
    });

    const outBuffer = await readFile(outputPath);
    return {
      key: `${baseKey}_${preset.name}.mp4`,
      buffer: outBuffer,
      contentType: 'video/mp4',
      size: outBuffer.length,
    };
  }
}
