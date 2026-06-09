import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { OptionalAuthGuard } from './optional-auth.guard';

@Module({
  providers: [AuthService, AuthGuard, OptionalAuthGuard],
  controllers: [AuthController],
  exports: [AuthService, AuthGuard, OptionalAuthGuard],
})
export class AuthModule {}
