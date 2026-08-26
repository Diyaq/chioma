// SPDX-License-Identifier: MIT
// Copyright (c) 2026 caxton strange

import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('file_metadata')
export class FileMetadata {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  fileName: string;

  @Column()
  fileSize: number;

  @Column()
  fileType: string;

  @Column()
  s3Key: string;

  @Column()
  ownerId: string;

  /**
   * Async processing state for files that need post-upload work (currently
   * video transcoding). Non-video uploads are processed inline and stay
   * 'completed'.
   */
  @Column({ type: 'varchar', length: 20, default: 'completed' })
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';

  /** Public URLs of generated variants (e.g. video quality tiers), keyed by name. */
  @Column({ type: 'jsonb', nullable: true })
  variants: Record<string, string> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
