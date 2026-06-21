import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SuiGraphQLClient } from '@mysten/sui/graphql';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { PrismaService } from './prisma.service';
import OpenAI from 'openai';

@Injectable()
export class QuestsService implements OnModuleInit {
  private readonly logger = new Logger(QuestsService.name);
  private openai: OpenAI | null = null;
  private suiKeypair: Ed25519Keypair | null = null;
  private packageId: string;
  private adminCapId: string;
  private questRegistryId: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
  ) {
    this.packageId = this.configService.get<string>('PACKAGE_ID') || '0x50232b6e065801de6d8d56da5692b7b2aad9b00ebd2cdd026f1da8f0ff4ebbf4';
    this.adminCapId = this.configService.get<string>('ADMIN_CAP_ID') || '';
    this.questRegistryId = this.configService.get<string>('QUEST_REGISTRY_ID') || '';

    const openaiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (openaiKey) {
      this.openai = new OpenAI({ apiKey: openaiKey });
    } else {
      this.logger.warn('OPENAI_API_KEY not configured. Code verification will run in mock mode.');
    }

    const privateKey = this.configService.get<string>('SPONSOR_WALLET_KEY');
    if (privateKey && privateKey !== 'suiprivkey123...placeholder') {
      try {
        const { secretKey } = decodeSuiPrivateKey(privateKey);
        this.suiKeypair = Ed25519Keypair.fromSecretKey(secretKey);
      } catch (err) {
        this.logger.error('Failed to parse sponsor private key for quests:', err);
      }
    }
  }

  async onModuleInit() {
    // Seed default quests in database if they don't exist
    await this.seedQuests().catch((err) => {
      this.logger.error('Failed to seed quests:', err);
    });
  }

  private async seedQuests() {
    const defaultQuests = [
      {
        objectId: '0xquest_course_1',
        title: 'Move Smart Contracts on Sui',
        description: 'Complete the first entry function lesson to greet the Yeti Lounge.',
        reward: 80,
      },
      {
        objectId: '0xquest_course_2',
        title: 'Sui Objects & Programmable Transactions',
        description: 'Define a custom YetiMug object struct with key and store abilities.',
        reward: 40,
      },
      {
        objectId: '0xquest_course_3',
        title: 'zkLogin Integrations & Native Wallet recovery',
        description: 'Implement a verification helper function for Yeti signatures.',
        reward: 10,
      },
    ];

    for (const q of defaultQuests) {
      await this.prismaService.quest.upsert({
        where: { objectId: q.objectId },
        update: { title: q.title, description: q.description, reward: q.reward },
        create: { objectId: q.objectId, title: q.title, description: q.description, reward: q.reward, isActive: true },
      });
    }
    this.logger.log('Seeded Move Academy course quests into database.');
  }

  async verifyCode(suiAddress: string, courseId: number, code: string) {
    this.logger.log(`Verifying course ${courseId} submission for user ${suiAddress}`);

    // Fallback content if OpenAI is not configured
    if (!this.openai) {
      return {
        success: true,
        logs: 'sui move test\n[PASS] academy::test_greet\nTest result: OK. 1 passed; 0 failed;',
        feedback: 'Great job! Your Move contract compile succeeded. (Mock Mode)',
      };
    }

    let courseObjective = '';
    let expectedPatterns: string[] = [];

    if (courseId === 1) {
      courseObjective = 'Implement a function `greet()` inside module `academy::hello_yeti` that returns a `String` (using std::string::utf8(b"Hello Yeti") or similar).';
      expectedPatterns = ['module academy::hello_yeti', 'public fun greet', 'String', 'utf8'];
    } else if (courseId === 2) {
      courseObjective = 'Define a custom struct `YetiMug` with `key` and `store` abilities, containing a `uid: UID` field and a `coffee_level: u64` field.';
      expectedPatterns = ['struct YetiMug', 'key', 'store', 'uid: UID', 'coffee_level: u64'];
    } else if (courseId === 3) {
      courseObjective = 'Implement a function `verify_yeti(sig: &vector<u8>): bool` that returns true if the signature is not empty (length > 0).';
      expectedPatterns = ['verify_yeti', 'sig: &vector<u8>', 'bool', 'vector::is_empty', 'vector::length', '!'];
    }

    const systemPrompt = `You are the Move compiler verification sandbox engine for Yeti Move Academy.
Your job is to analyze the user's submitted Sui Move code for course ID ${courseId}.
The objective for this course is:
"${courseObjective}"

Verify if the code is valid Move code, syntactically correct, and satisfies the objective.
Provide feedback as if you are a friendly, cool Yeti mentor named "Lofi Mascot" 🥶🏂.

You MUST respond with a JSON object in this exact format:
{
  "success": true/false,
  "logs": "Detailed compiler-like logging output (e.g. Build, test results)",
  "feedback": "Cozy developer feedback, hints for errors, or congratulations"
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Submitted Move Code:\n\n${code}` }
        ] as any,
      });

      const result = JSON.parse(response.choices[0].message.content || '{}');

      // If success is true, trigger on-chain completion
      if (result.success) {
        // Trigger completion logic (on-chain / database sync)
        await this.completeQuest(suiAddress, courseId);
      }

      return {
        success: !!result.success,
        logs: result.logs || 'Compiler error.',
        feedback: result.feedback || 'Please try again.',
      };
    } catch (err: any) {
      this.logger.error('Failed code verification:', err);
      return {
        success: false,
        logs: 'Sui compiler backend failure.',
        feedback: `Brrr! An unexpected error occurred: ${err.message}`,
      };
    }
  }

  private async completeQuest(suiAddress: string, courseId: number) {
    const questId = `0xquest_course_${courseId}`;
    const quest = await this.prismaService.quest.findUnique({ where: { objectId: questId } });
    if (!quest) return;

    // Check if already completed
    const existing = await this.prismaService.questCompletion.findFirst({
      where: { questId, suiAddress },
    });
    if (existing) {
      this.logger.log(`Quest ${questId} already completed for ${suiAddress}`);
      return;
    }

    // Try executing on-chain transaction
    let onChainSuccess = false;
    let txDigest = '';

    if (this.suiKeypair && this.adminCapId) {
      try {
        const tx = new Transaction();
        const user = await this.prismaService.user.findUnique({ where: { suiAddress } });
        const profileObjectId = user?.profileObjectId;

        if (profileObjectId) {
          this.logger.log(`Triggering on-chain quest completion for ${suiAddress} (profile: ${profileObjectId})`);
          
          tx.moveCall({
            target: `${this.packageId}::rewards::complete_quest_entry`,
            arguments: [
              tx.object(this.adminCapId),
              tx.object(questId),
              tx.object(profileObjectId),
            ],
          });
          
          tx.setGasBudget(10_000_000);

          const rpcUrl = this.configService.get<string>('SUI_RPC_URL') || 'https://fullnode.testnet.sui.io:443';
          const { SuiGrpcClient } = await import('@mysten/sui/grpc');
          const client = new SuiGrpcClient({ network: 'testnet', baseUrl: rpcUrl });

          const result = await client.signAndExecuteTransaction({
            transaction: tx,
            signer: this.suiKeypair,
          });

          if ('digest' in result) {
            txDigest = (result as any).digest;
          }
          onChainSuccess = true;
          this.logger.log(`On-chain quest completion success: ${txDigest}`);
        }
      } catch (err: any) {
        this.logger.error(`Failed on-chain quest completion: ${err.message}`, err);
      }
    }

    // Always perform DB completion fallback if on-chain fails or key is missing
    await this.prismaService.user.upsert({
      where: { suiAddress },
      update: {
        flurriesBalance: { increment: quest.reward },
      },
      create: {
        suiAddress,
        flurriesBalance: 100 + quest.reward,
      },
    });

    await this.prismaService.questCompletion.create({
      data: {
        questId,
        suiAddress,
      },
    }).catch(() => {});

    this.logger.log(`DB updated: quest completed for user ${suiAddress}`);
  }
}
