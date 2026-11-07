import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { JwtPayload } from '../common/interfaces/jwt.interface';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let configService: ConfigService;

  beforeEach(() => {
    configService = {
      get: jest.fn().mockReturnValue('test-jwt-secret'),
    } as unknown as ConfigService;

    strategy = new JwtStrategy(configService);
  });

  it('validates and returns payload when required claims exist', () => {
    const payload: JwtPayload = {
      sub: 'inv-123',
      tenant_id: 'tenant-abc',
      investor_id: 'inv-123',
    };

    expect(strategy.validate(payload)).toEqual(payload);
  });

  it('throws UnauthorizedException when tenant_id is missing', () => {
    const payload = {
      sub: 'inv-123',
      investor_id: 'inv-123',
    } as JwtPayload;

    expect(() => strategy.validate(payload)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when investor_id is missing', () => {
    const payload = {
      sub: 'inv-123',
      tenant_id: 'tenant-abc',
    } as JwtPayload;

    expect(() => strategy.validate(payload)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when payload is null or undefined', () => {
    expect(() => strategy.validate(undefined as unknown as JwtPayload)).toThrow(
      UnauthorizedException,
    );
  });
});

