// SPDX-License-Identifier: MIT
// Copyright (c) 2026 caxton strange

import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { DataRetentionService } from './data-retention.service';
import { User } from '../users/entities/user.entity';
import { Notification } from '../notifications/entities/notification.entity';

describe('DataRetentionService', () => {
  function buildService(overrides?: {
    graceDays?: string;
    retentionDays?: string;
  }) {
    const userRepository = {
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
      count: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<Repository<User>>;

    const notificationRepository = {
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    } as unknown as jest.Mocked<Repository<Notification>>;

    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'USER_ERASURE_GRACE_DAYS') return overrides?.graceDays;
        if (key === 'NOTIFICATION_RETENTION_DAYS')
          return overrides?.retentionDays;
        return undefined;
      }),
    } as unknown as ConfigService;

    const service = new DataRetentionService(
      userRepository,
      notificationRepository,
      configService,
    );

    return { service, userRepository, notificationRepository };
  }

  it('permanently deletes users soft-deleted past the grace period', async () => {
    const { service, userRepository } = buildService();
    (userRepository.find as jest.Mock).mockResolvedValue([
      { id: 'user-1' },
      { id: 'user-2' },
    ]);

    const stats = await service.enforceRetention();

    expect(userRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({ withDeleted: true }),
    );
    expect(userRepository.delete).toHaveBeenCalledWith(['user-1', 'user-2']);
    expect(stats.usersPurged).toBe(2);
    expect(stats.errors).toBe(0);
  });

  it('does not call delete when no users are past the grace period', async () => {
    const { service, userRepository } = buildService();

    const stats = await service.enforceRetention();

    expect(userRepository.delete).not.toHaveBeenCalled();
    expect(stats.usersPurged).toBe(0);
  });

  it('deletes notifications older than the retention window', async () => {
    const { service, notificationRepository } = buildService();
    (notificationRepository.delete as jest.Mock).mockResolvedValue({
      affected: 5,
    });

    const stats = await service.enforceRetention();

    expect(notificationRepository.delete).toHaveBeenCalled();
    expect(stats.notificationsDeleted).toBe(5);
  });

  it('falls back to defaults when retention env vars are unset', async () => {
    const { service } = buildService();

    const stats = await service.getRetentionStats();

    expect(stats.userErasureGraceDays).toBe(30);
    expect(stats.notificationRetentionDays).toBe(90);
  });

  it('honors configured retention overrides', async () => {
    const { service } = buildService({ graceDays: '14', retentionDays: '30' });

    const stats = await service.getRetentionStats();

    expect(stats.userErasureGraceDays).toBe(14);
    expect(stats.notificationRetentionDays).toBe(30);
  });

  it('records an error and keeps going when user purge fails', async () => {
    const { service, userRepository, notificationRepository } = buildService();
    (userRepository.find as jest.Mock).mockRejectedValue(new Error('db down'));
    (notificationRepository.delete as jest.Mock).mockResolvedValue({
      affected: 3,
    });

    const stats = await service.enforceRetention();

    expect(stats.errors).toBe(1);
    expect(stats.usersPurged).toBe(0);
    expect(stats.notificationsDeleted).toBe(3);
  });
});
