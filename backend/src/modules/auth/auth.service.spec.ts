import * as bcrypt from 'bcryptjs';

import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { User, UserRole } from '../users/entities/user.entity';

import {
  AuthenticationError,
  DuplicateEntryError,
  ValidationError,
} from '../../common/errors/domain-errors';
import { AuthService } from './auth.service';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../notifications/email.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from './dto/login.dto';
import { MfaDevice } from './entities/mfa-device.entity';
import { MfaService } from './services/mfa.service';
import { PasswordPolicyService } from './services/password-policy.service';
import { RegisterDto } from './dto/register.dto';
import { Repository } from 'typeorm';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ReferralService } from '../referral/referral.service';
import { LoggerService } from '../../common/services/logger.service';
import { LockService } from '../../common/lock';
import { REDIS_CLIENT } from '../../common/lock/redis-client.token';
import { CompleteProfileDto } from './dto/complete-profile.dto';

describe('AuthService', () => {
  let service: AuthService;
  let _userRepository: Repository<User>;
  let _jwtService: JwtService;
  let _configService: ConfigService;
  let emailService: EmailService;

  const mockUser: Partial<User> = {
    id: 'test-user-id',
    email: 'test@example.com',
    password: 'hashed-password',
    firstName: 'Test',
    lastName: 'User',
    role: UserRole.USER,
    isActive: true,
    emailVerified: true,
    failedLoginAttempts: 0,
    accountLockedUntil: null,
    resetTokenExpires: null,
    resetToken: null,
    refreshToken: null,
    lastLoginAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    phoneNumber: null,
    avatarUrl: null,
    verificationToken: null,
  };

  const mockUserRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn(),
    verify: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config = {
        JWT_SECRET: 'test-secret',
        JWT_REFRESH_SECRET: 'test-refresh-secret',
        JWT_EXPIRATION: '15m',
        JWT_REFRESH_EXPIRATION: '7d',
      };
      return config[key as never];
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: getRepositoryToken(MfaDevice),
          useValue: { findOne: jest.fn(), save: jest.fn() },
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: PasswordPolicyService,
          useValue: {
            validatePassword: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: EmailService,
          useValue: {
            sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
            sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: MfaService,
          useValue: {
            checkMfaRequired: jest.fn().mockResolvedValue(false),
            generateMfaToken: jest.fn().mockResolvedValue(undefined),
            verifyMfaToken: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ReferralService,
          useValue: {
            generateReferralCode: jest.fn().mockResolvedValue('REF12345'),
            trackReferral: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: LoggerService,
          useValue: {
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
        {
          provide: LockService,
          useValue: {
            withLock: jest.fn(
              async (
                _key: string,
                _ttlMs: number,
                fn: () => Promise<unknown>,
              ) => fn(),
            ),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    _userRepository = module.get<Repository<User>>(getRepositoryToken(User));
    _jwtService = module.get<JwtService>(JwtService);
    _configService = module.get<ConfigService>(ConfigService);
    emailService = module.get<EmailService>(EmailService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should register a new user successfully', async () => {
      const registerDto: RegisterDto = {
        email: 'newuser@example.com',
        password: 'SecurePass123!',
        firstName: 'New',
        lastName: 'User',
        role: UserRole.USER,
      };

      const hashedPassword = 'hashed-password';
      const newUser = {
        ...mockUser,
        ...registerDto,
        passwordHash: hashedPassword,
      };

      mockUserRepository.findOne.mockResolvedValue(null);
      mockUserRepository.create.mockReturnValue(newUser);
      mockUserRepository.save.mockResolvedValue(newUser);
      mockJwtService.sign
        .mockReturnValueOnce('mock-access-token')
        .mockReturnValueOnce('mock-refresh-token');
      jest.spyOn(bcrypt, 'hash').mockResolvedValue(hashedPassword as never);

      const result = await service.register(registerDto);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user.email).toBe(registerDto.email);
      expect(mockUserRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.arrayContaining([
            expect.objectContaining({ email: registerDto.email }),
          ]),
          withDeleted: true,
        }),
      );
      expect(mockUserRepository.save).toHaveBeenCalled();
      expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(
        registerDto.email,
        expect.any(String),
      );
    });

    it('should throw DuplicateEntryError if email already exists', async () => {
      const registerDto: RegisterDto = {
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        role: UserRole.USER,
      };

      mockUserRepository.findOne.mockResolvedValue(mockUser);

      await expect(service.register(registerDto)).rejects.toThrow(
        DuplicateEntryError,
      );
    });
  });

  describe('login', () => {
    it('should login user successfully', async () => {
      const loginDto: LoginDto = {
        email: 'test@example.com',
        password: 'password123',
      };

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed-token' as never);
      mockJwtService.sign
        .mockReturnValueOnce('mock-access-token')
        .mockReturnValueOnce('mock-refresh-token');

      const result = await service.login(loginDto);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user.email).toBe(mockUser.email);
      expect(mockUserRepository.save).toHaveBeenCalled();
    });

    it('should throw UnauthorizedException for invalid password', async () => {
      const loginDto: LoginDto = {
        email: 'test@example.com',
        password: 'wrongpassword',
      };

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(service.login(loginDto)).rejects.toThrow(
        AuthenticationError,
      );
    });

    it('should throw AuthenticationError for non-existent user', async () => {
      const loginDto: LoginDto = {
        email: 'nonexistent@example.com',
        password: 'password123',
      };

      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(
        AuthenticationError,
      );
    });

    it('should throw AuthenticationError for inactive account', async () => {
      const loginDto: LoginDto = {
        email: 'test@example.com',
        password: 'password123',
      };

      mockUserRepository.findOne.mockResolvedValue({
        ...mockUser,
        isActive: false,
      });

      await expect(service.login(loginDto)).rejects.toThrow(
        AuthenticationError,
      );
    });

    it('should handle account lockout after failed attempts', async () => {
      const loginDto: LoginDto = {
        email: 'test@example.com',
        password: 'password123',
      };
      const lockedUser = {
        ...mockUser,
        accountLockedUntil: new Date(Date.now() + 3600000),
      };

      mockUserRepository.findOne.mockResolvedValue(lockedUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(service.login(loginDto)).rejects.toThrow(
        AuthenticationError,
      );
    });
  });

  describe('forgotPassword', () => {
    it('should generate reset token for existing user', async () => {
      const forgotPasswordDto: ForgotPasswordDto = {
        email: 'test@example.com',
      };

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockUserRepository.save.mockResolvedValue(mockUser);

      const result = await service.forgotPassword(forgotPasswordDto);

      expect(result).toHaveProperty('message');
      expect(result.message).toContain('If an account exists');
      expect(mockUserRepository.save).toHaveBeenCalled();
      expect(emailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        forgotPasswordDto.email,
        expect.any(String),
      );
    });

    it('should return generic message for non-existent email (security)', async () => {
      const forgotPasswordDto: ForgotPasswordDto = {
        email: 'nonexistent@example.com',
      };

      mockUserRepository.findOne.mockResolvedValue(null);

      const result = await service.forgotPassword(forgotPasswordDto);

      expect(result.message).toBeDefined();
      expect(result.message).toContain('If an account exists');
      expect(mockUserRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('should reset password with valid token', async () => {
      const mockUserWithToken = {
        ...mockUser,
        passwordResetToken: 'hashed-token',
        resetTokenExpiresAt: new Date(Date.now() + 3600000),
      };

      const resetPasswordDto: ResetPasswordDto = {
        token: 'reset-token',
        newPassword: 'NewSecurePass123!',
      };

      mockUserRepository.findOne.mockResolvedValue(mockUserWithToken);
      mockUserRepository.save.mockResolvedValue(mockUser);
      jest
        .spyOn(bcrypt, 'hash')
        .mockResolvedValue('new-hashed-password' as never);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      const result = await service.resetPassword(resetPasswordDto);

      expect(result).toHaveProperty('message');
      expect(mockUserRepository.save).toHaveBeenCalled();
    });

    it('should throw BadRequestException for invalid token', async () => {
      const resetPasswordDto: ResetPasswordDto = {
        token: 'invalid-token',
        newPassword: 'new-password',
      };

      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.resetPassword(resetPasswordDto)).rejects.toThrow(
        ValidationError,
      );
    });

    it('should throw BadRequestException for expired token', async () => {
      const resetPasswordDto: ResetPasswordDto = {
        token: 'expired-token',
        newPassword: 'new-password',
      };

      mockUserRepository.findOne.mockResolvedValue({
        ...mockUser,
        resetTokenExpires: new Date(Date.now() - 3600000),
      });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      await expect(service.resetPassword(resetPasswordDto)).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe('verifyEmail', () => {
    it('should verify email successfully', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockUserRepository.save.mockResolvedValue(mockUser);

      await service.verifyEmail('valid-token');

      expect(mockUserRepository.save).toHaveBeenCalled();
    });

    it('should throw BadRequestException with invalid token', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.verifyEmail('invalid-token')).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe('completeProfile', () => {
    const walletUser: Partial<User> = {
      id: 'wallet-user-id',
      email: null as unknown as string,
      emailVerified: false,
      verificationToken: null,
      firstName: 'Wallet',
      lastName: 'User',
    };

    const dto: CompleteProfileDto = {
      email: 'newemail@example.com',
      firstName: 'Ada',
      lastName: 'Okafor',
    };

    it('throws ValidationError when the user does not exist', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.completeProfile('missing-id', dto)).rejects.toThrow(
        ValidationError,
      );
    });

    it('throws DuplicateEntryError when the email belongs to another user', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce(walletUser)
        .mockResolvedValueOnce({ ...mockUser, id: 'someone-else' });

      await expect(
        service.completeProfile('wallet-user-id', dto),
      ).rejects.toThrow(DuplicateEntryError);
    });

    it('generates and saves a new verification token on first completion', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce({ ...walletUser })
        .mockResolvedValueOnce(null);
      mockUserRepository.save.mockImplementation((u) => Promise.resolve(u));

      await service.completeProfile('wallet-user-id', dto);

      expect(mockUserRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'newemail@example.com',
          emailVerified: false,
          verificationToken: expect.any(String),
        }),
      );
      const savedUser = mockUserRepository.save.mock.calls[0][0];
      expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(
        'newemail@example.com',
        savedUser.verificationToken,
      );
    });

    it('reuses the existing pending token instead of generating a new one when resending for the same unverified email', async () => {
      const userWithPendingToken = {
        ...walletUser,
        email: 'newemail@example.com',
        emailVerified: false,
        verificationToken: 'existing-pending-token',
      };
      mockUserRepository.findOne
        .mockResolvedValueOnce({ ...userWithPendingToken })
        .mockResolvedValueOnce({ ...userWithPendingToken });
      mockUserRepository.save.mockImplementation((u) => Promise.resolve(u));

      await service.completeProfile('wallet-user-id', dto);

      expect(mockUserRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          verificationToken: 'existing-pending-token',
        }),
      );
      expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(
        'newemail@example.com',
        'existing-pending-token',
      );
    });

    it('generates a fresh token when the previous email was already verified', async () => {
      const verifiedUser = {
        ...walletUser,
        email: 'old@example.com',
        emailVerified: true,
        verificationToken: null,
      };
      mockUserRepository.findOne
        .mockResolvedValueOnce({ ...verifiedUser })
        .mockResolvedValueOnce(null);
      mockUserRepository.save.mockImplementation((u) => Promise.resolve(u));

      await service.completeProfile('wallet-user-id', dto);

      const savedUser = mockUserRepository.save.mock.calls[0][0];
      expect(savedUser.verificationToken).toEqual(expect.any(String));
      expect(savedUser.verificationToken).not.toBeNull();
    });

    describe('concurrent calls', () => {
      it('converges on a single verification token instead of each concurrent call overwriting the other', async () => {
        let storedUser: any = { ...walletUser };

        const statefulUserRepository = {
          findOne: jest.fn(async () => ({ ...storedUser })),
          save: jest.fn(async (u: any) => {
            storedUser = { ...u };
            return storedUser;
          }),
          create: jest.fn(),
          update: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
          providers: [
            AuthService,
            {
              provide: getRepositoryToken(User),
              useValue: statefulUserRepository,
            },
            {
              provide: getRepositoryToken(MfaDevice),
              useValue: { findOne: jest.fn(), save: jest.fn() },
            },
            { provide: JwtService, useValue: mockJwtService },
            { provide: ConfigService, useValue: mockConfigService },
            {
              provide: PasswordPolicyService,
              useValue: {
                validatePassword: jest.fn().mockResolvedValue(undefined),
              },
            },
            {
              provide: EmailService,
              useValue: {
                sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
                sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
              },
            },
            {
              provide: MfaService,
              useValue: {
                checkMfaRequired: jest.fn().mockResolvedValue(false),
                generateMfaToken: jest.fn().mockResolvedValue(undefined),
                verifyMfaToken: jest.fn().mockResolvedValue(undefined),
              },
            },
            {
              provide: ReferralService,
              useValue: {
                generateReferralCode: jest.fn().mockResolvedValue('REF12345'),
                trackReferral: jest.fn().mockResolvedValue(undefined),
              },
            },
            {
              provide: LoggerService,
              useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
            },
            // Real LockService (in-memory, no Redis) so @Locked actually
            // serializes the concurrent completeProfile calls below.
            LockService,
            { provide: REDIS_CLIENT, useValue: null },
          ],
        }).compile();

        const concurrentService = module.get<AuthService>(AuthService);
        const concurrentEmailService = module.get<EmailService>(EmailService);

        await Promise.all([
          concurrentService.completeProfile('wallet-user-id', dto),
          concurrentService.completeProfile('wallet-user-id', dto),
          concurrentService.completeProfile('wallet-user-id', dto),
        ]);

        expect(storedUser.verificationToken).toEqual(expect.any(String));

        const sentTokens = (
          concurrentEmailService.sendVerificationEmail as jest.Mock
        ).mock.calls.map(([, token]: [string, string]) => token);

        expect(sentTokens).toHaveLength(3);
        expect(new Set(sentTokens).size).toBe(1);
        expect(sentTokens[0]).toBe(storedUser.verificationToken);
      });
    });
  });

  describe('logout', () => {
    it('should logout user successfully', async () => {
      mockUserRepository.update.mockResolvedValue({ affected: 1 } as any);

      const result = await service.logout('test-user-id');

      expect(result).toHaveProperty('message');
      expect(mockUserRepository.update).toHaveBeenCalledWith(
        { id: 'test-user-id' },
        { refreshToken: null },
      );
    });
  });

  describe('validateUserById', () => {
    it('should return user if exists', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.validateUserById('test-user-id');

      expect(result.id).toBe(mockUser.id);
    });

    it('should throw UnauthorizedException for non-existent user', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.validateUserById('non-existent-id')).rejects.toThrow(
        AuthenticationError,
      );
    });
  });
});
