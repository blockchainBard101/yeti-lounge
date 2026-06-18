import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly tokenSecret: string;
  private readonly suiClient: SuiGrpcClient;

  constructor() {
    this.tokenSecret = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
    const rpcUrl = process.env.SUI_RPC_URL || 'https://fullnode.testnet.sui.io:443';
    this.suiClient = new SuiGrpcClient({ network: 'testnet', baseUrl: rpcUrl });
  }

  async verifyLogin(
    suiAddress: string,
    signature: string,
    message: string,
  ): Promise<boolean> {
    try {
      // 1. Verify message matches the claiming address and contains a valid timestamp
      const parsed = JSON.parse(message);
      if (parsed.address.toLowerCase() !== suiAddress.toLowerCase()) {
        throw new UnauthorizedException('Claimed address does not match message address');
      }

      const timestamp = Number(parsed.timestamp);
      const now = Date.now();
      // Require logins to be signed within 15 minutes to prevent replay attacks
      if (isNaN(timestamp) || Math.abs(now - timestamp) > 15 * 60 * 1000) {
        throw new UnauthorizedException('Login session message expired or timestamp invalid');
      }

      // 2. Cryptographically verify signature on-chain/off-chain standard for Sui personal messages
      const messageBytes = new TextEncoder().encode(message);
      const publicKey = await verifyPersonalMessageSignature(messageBytes, signature, {
        client: this.suiClient,
      });
      const derivedAddress = publicKey.toSuiAddress();

      if (derivedAddress.toLowerCase() !== suiAddress.toLowerCase()) {
        throw new UnauthorizedException('Signature does not match public key derivation');
      }

      return true;
    } catch (err: any) {
      this.logger.error(`Login verification failed: ${err.message || err}`);
      throw new UnauthorizedException(err.message || 'Signature verification failed');
    }
  }

  generateToken(suiAddress: string): string {
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    const payload = JSON.stringify({ suiAddress, expiresAt });
    const hmac = crypto.createHmac('sha256', this.tokenSecret);
    hmac.update(payload);
    const signature = hmac.digest('hex');

    return Buffer.from(
      JSON.stringify({
        payload: { suiAddress, expiresAt },
        signature,
      }),
    ).toString('base64');
  }

  verifyToken(token: string): string {
    try {
      const decodedStr = Buffer.from(token, 'base64').toString('utf-8');
      const decoded = JSON.parse(decodedStr);
      const { payload, signature } = decoded;

      // Recalculate signature
      const hmac = crypto.createHmac('sha256', this.tokenSecret);
      hmac.update(JSON.stringify(payload));
      const expectedSignature = hmac.digest('hex');

      if (signature !== expectedSignature) {
        throw new UnauthorizedException('Invalid token signature');
      }

      if (Date.now() > payload.expiresAt) {
        throw new UnauthorizedException('Token has expired');
      }

      return payload.suiAddress;
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired authentication token');
    }
  }
}
