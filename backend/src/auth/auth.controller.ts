import { Controller, Post, Body, Get, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(
    @Body('suiAddress') suiAddress: string,
    @Body('signature') signature: string,
    @Body('message') message: string,
  ) {
    await this.authService.verifyLogin(suiAddress, signature, message);
    const token = this.authService.generateToken(suiAddress);
    return { token, success: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@Req() req: any) {
    return { suiAddress: req.user.suiAddress };
  }
}
