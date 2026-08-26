// SPDX-License-Identifier: MIT
// Copyright (c) 2026 caxton strange

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { User } from '../users/entities/user.entity';
import { Notification } from '../notifications/entities/notification.entity';

export interface DataRetentionStats {
  usersPurged: number;
  notificationsDeleted: number;
  errors: number;
  duration: number;
}

/**
 * Enforces GDPR "storage limitation" (Art. 5(1)(e)) for data categories that
 * have no other cleanup path: soft-deleted user accounts and stale
 * notifications. Soft delete alone (see UsersService.softDelete/restore)
 * keeps personal data indefinitely, so accounts past the erasure grace
 * period are permanently purged here.
 */
@Injectable()
export class DataRetentionService {
  private readonly logger = new Logger(DataRetentionService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    private readonly configService: ConfigService,
  ) {}

  private getUserErasureGraceDays(): number {
    const configured = this.configService.get<string>(
      'USER_ERASURE_GRACE_DAYS',
    );
    const parsed = configured ? parseInt(configured, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
  }

  private getNotificationRetentionDays(): number {
    const configured = this.configService.get<string>(
      'NOTIFICATION_RETENTION_DAYS',
    );
    const parsed = configured ? parseInt(configured, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 90;
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async performScheduledRetention(): Promise<DataRetentionStats> {
    this.logger.log('Starting scheduled data retention enforcement');
    const stats = await this.enforceRetention();
    this.logger.log(
      `Data retention completed: ${stats.usersPurged} users purged, ` +
        `${stats.notificationsDeleted} notifications deleted, ` +
        `${stats.errors} errors, ${stats.duration}ms`,
    );
    return stats;
  }

  async enforceRetention(): Promise<DataRetentionStats> {
    const startTime = Date.now();
    const stats: DataRetentionStats = {
      usersPurged: 0,
      notificationsDeleted: 0,
      errors: 0,
      duration: 0,
    };

    try {
      stats.usersPurged = await this.purgeSoftDeletedUsers();
    } catch (error) {
      stats.errors++;
      this.logger.error(`Failed to purge soft-deleted users: ${error.message}`);
    }

    try {
      stats.notificationsDeleted = await this.purgeOldNotifications();
    } catch (error) {
      stats.errors++;
      this.logger.error(`Failed to purge old notifications: ${error.message}`);
    }

    stats.duration = Date.now() - startTime;
    return stats;
  }

  /**
   * Permanently deletes users whose soft delete (`deletedAt`) is older than
   * the erasure grace period. Related rows with `ON DELETE CASCADE` (e.g.
   * notifications) are removed by the database; anything else referencing
   * the user is left to the orphaned-records cleanup.
   */
  private async purgeSoftDeletedUsers(): Promise<number> {
    const graceDays = this.getUserErasureGraceDays();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - graceDays);

    const toPurge = await this.userRepository.find({
      where: { deletedAt: LessThan(cutoff) },
      withDeleted: true,
      select: ['id'],
    });

    if (toPurge.length === 0) return 0;

    await this.userRepository.delete(toPurge.map((u) => u.id));
    this.logger.log(
      `Permanently purged ${toPurge.length} user(s) soft-deleted more than ${graceDays} days ago`,
    );
    return toPurge.length;
  }

  private async purgeOldNotifications(): Promise<number> {
    const retentionDays = this.getNotificationRetentionDays();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    const result = await this.notificationRepository.delete({
      createdAt: LessThan(cutoff),
    });
    return result.affected || 0;
  }

  async getRetentionStats(): Promise<{
    pendingUserErasure: number;
    userErasureGraceDays: number;
    notificationRetentionDays: number;
  }> {
    const graceDays = this.getUserErasureGraceDays();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - graceDays);

    const pendingUserErasure = await this.userRepository.count({
      where: { deletedAt: LessThan(cutoff) },
      withDeleted: true,
    });

    return {
      pendingUserErasure,
      userErasureGraceDays: graceDays,
      notificationRetentionDays: this.getNotificationRetentionDays(),
    };
  }
}
