import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from './auth.service';

@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    request.user = { suiAddress: null };

    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.split(' ')[1];
        const suiAddress = this.authService.verifyToken(token);
        request.user = { suiAddress };
      } catch (err) {
        // Silently ignore invalid tokens for optional endpoints, acting as a guest
      }
    }

    return true;
  }
}
