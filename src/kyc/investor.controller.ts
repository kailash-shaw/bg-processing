import {
  Controller,
  Get,
  Param,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { InvestorService } from './investor.service';
import { InvestorKycStatusResponse } from '../common/interfaces/investor-kyc-status.interface';
import { JwtPayload } from '../common/interfaces/jwt.interface';

@Controller('investors')
export class InvestorController {
  constructor(private readonly investorService: InvestorService) {}

  @Get(':id/kyc-status')
  @UseGuards(AuthGuard('jwt'))
  getKycStatus(
    @Param('id') investorId: string,
    @Req() request: Request & { user?: JwtPayload },
  ): Promise<InvestorKycStatusResponse> {
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException('Authenticated user is missing');
    }
    return this.investorService.getKycStatus(investorId, user);
  }
}
