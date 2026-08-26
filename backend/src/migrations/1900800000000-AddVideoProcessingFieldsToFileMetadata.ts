// SPDX-License-Identifier: MIT
// Copyright (c) 2026 caxton strange

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the columns FileMetadata needs to track async video transcoding:
 * `processing_status` for the pending/processing/completed/failed lifecycle
 * and `variants` for the resulting quality-tier URLs.
 */
export class AddVideoProcessingFieldsToFileMetadata1900800000000 implements MigrationInterface {
  name = 'AddVideoProcessingFieldsToFileMetadata1900800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "file_metadata"
      ADD COLUMN IF NOT EXISTS "processing_status" character varying(20) NOT NULL DEFAULT 'completed',
      ADD COLUMN IF NOT EXISTS "variants" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "file_metadata"
      DROP COLUMN IF EXISTS "processing_status",
      DROP COLUMN IF EXISTS "variants"
    `);
  }
}
