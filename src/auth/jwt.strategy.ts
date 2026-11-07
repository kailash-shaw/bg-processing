import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../common/interfaces/jwt.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('JWT_SECRET') ?? 'local-dev-jwt-secret',
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    if (!payload || !payload.tenant_id || !payload.investor_id) {
      throw new UnauthorizedException(
        'JWT payload is missing required tenant_id or investor_id claims',
      );
    }

    return payload;
  }
}
