import { Controller, Post, Body, Logger, BadRequestException, UseGuards, Req, Get, Query } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import OpenAI, { toFile } from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { WalrusMemoryService } from './walrus-memory.service';
import { WalrusService } from './walrus.service';
import { PrismaService } from './prisma.service';
import { TxVerifierService } from './tx-verifier.service';
import { OptionalAuthGuard } from './auth/optional-auth.guard';

const CURATOR_ADDRESS = '0x0000000000000000000000000000000000000000000000000000000000000c01';

const ASSET_MAPPINGS: Record<string, string> = {
  'yeti-mascot.png': 'j9xkr0qHdPJusiM1oGUhxEJkSkJOkkDHTWXPPKFJszo',
  'lofi-switch.jpeg': 'aN8WoBb7gAm5y5LHGetMiw161OEDcaTW-h_UfGcyZVE',
  'yeti-hackathon.jpeg': 'V-QllFYi8ZIvCUcxrbgmdM5KaZx14Fp8jLhBEaEmS7Y',
  'yeti-hand-ok-lofi.jpeg': '9428ETFhA-8V_NMFku2wSueel8zWSnvv2jllmkfIvmQ',
  'yeti-igloo.jpeg': '8Aeig5z_XXpcq3jXn6I34A0HPJJI50x2oeX4ce3viZQ',
  'yeti-jetpack.jpeg': 'lsenSK2TOzPcnPflSH4xdCbbDDmSc2qUEADh_nRng-o',
  'yeti-live-on-sui.jpeg': 'wNSO8n-OyaAIDoX6YB3pfKrg-fgctj7pbw_QL8X15As',
  'yeti-lofi-study.jpeg': '5QIhJ9NIJq6j0ftYeycJ_uFA8ZLabK8n6AsTRr_hTKQ',
  'yeti-mainframe.jpeg': 'vG95mguTWBZagHcgSV3nQ0i1gp6D_78j1T4qT1YPfvM',
  'yeti-stage-presentation.jpeg': 'f7DbaSHZzovA2bCL1sEhKT_sYZ_NfDCQPcw-B8zWZTM',
  'yeti-sustainable-growth.jpeg': '24jJtt0JTdAxLNk700GGzE9zJaUi2Y7oLQ2mO2O6UxU',
  'yeti-walking-road.jpeg': 'MDRNzmEKVd-w4FcjJm8I2ti8mxVjNcixIGkLPr4h-WU'
};

@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(
    private readonly walrusMemoryService: WalrusMemoryService,
    private readonly walrusService: WalrusService,
    private readonly prismaService: PrismaService,
    private readonly txVerifierService: TxVerifierService,
  ) {}

  private async loadReferenceImage(filename: string): Promise<Buffer> {
    const localPath = path.resolve(process.cwd(), 'public/lofi-img', filename);
    try {
      if (fs.existsSync(localPath)) {
        return fs.readFileSync(localPath);
      }
    } catch (err) {
      this.logger.debug(`Could not read local reference image ${filename} at ${localPath}: ${err.message}`);
    }

    const blobId = ASSET_MAPPINGS[filename];
    if (!blobId) {
      return Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        'base64',
      );
    }

    const aggregatorUrl = `https://aggregator.walrus-testnet.walrus.space/v1/blobs/${blobId}`;
    this.logger.log(`Fetching reference image "${filename}" from Walrus: ${aggregatorUrl}`);

    try {
      const response = await fetch(aggregatorUrl);
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      }
    } catch (fetchErr) {
      this.logger.error(`Failed to fetch reference image "${filename}" from Walrus: ${fetchErr.message}`);
    }

    // Ultimate transparent 1x1 PNG fallback to prevent crash
    return Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    );
  }

  private async checkAndConsumeDailyLimit(
    suiAddress: string,
    limitField: 'freeChatsRemaining' | 'freeImageGensRemaining',
    txDigest: string | undefined,
    costLofi: number,
    purpose: string,
  ): Promise<{ freeUsed: boolean }> {
    if (!suiAddress) {
      throw new BadRequestException('suiAddress is required.');
    }

    const todayStr = new Date().toISOString().split('T')[0];

    let user = await this.prismaService.user.findUnique({
      where: { suiAddress },
    });

    if (!user) {
      user = await this.prismaService.user.create({
        data: {
          suiAddress,
          freeChatsRemaining: 5,
          freeImageGensRemaining: 1,
          lastUsageDate: todayStr,
        },
      });
    }

    if (user.lastUsageDate !== todayStr) {
      user = await this.prismaService.user.update({
        where: { suiAddress },
        data: {
          freeChatsRemaining: 5,
          freeImageGensRemaining: 1,
          lastUsageDate: todayStr,
        },
      });
    }

    const remaining = user[limitField];

    if (remaining > 0) {
      await this.prismaService.user.update({
        where: { suiAddress },
        data: {
          [limitField]: remaining - 1,
        },
      });
      return { freeUsed: true };
    }

    if (!txDigest) {
      throw new BadRequestException(`No free attempts remaining. A transaction of ${costLofi} LOFI is required.`);
    }

    await this.txVerifierService.verifyPayment(txDigest, suiAddress, costLofi, purpose);
    return { freeUsed: false };
  }

  @Get('free-credits')
  async getFreeCredits(@Query('address') address: string) {
    if (!address) {
      throw new BadRequestException('Missing address query parameter');
    }
    const todayStr = new Date().toISOString().split('T')[0];
    let user = await this.prismaService.user.findUnique({
      where: { suiAddress: address },
    });
    if (!user) {
      user = await this.prismaService.user.create({
        data: {
          suiAddress: address,
          freeChatsRemaining: 5,
          freeImageGensRemaining: 1,
          lastUsageDate: todayStr,
        },
      });
    } else if (user.lastUsageDate !== todayStr) {
      user = await this.prismaService.user.update({
        where: { suiAddress: address },
        data: {
          freeChatsRemaining: 5,
          freeImageGensRemaining: 1,
          lastUsageDate: todayStr,
        },
      });
    }
    return {
      freeImageGensRemaining: user.freeImageGensRemaining,
      freeChatsRemaining: user.freeChatsRemaining,
    };
  }

  @Post('generate')
  @UseGuards(OptionalAuthGuard)
  async generateImage(
    @Req() req: any,
    @Body('prompt') prompt: string,
    @Body('suiAddress') suiAddressOverride?: string,
    @Body('txDigest') txDigest?: string,
  ) {
    const suiAddress = req.user.suiAddress || suiAddressOverride;
    this.logger.log(`[generateImage] Starting image generation. User: ${suiAddress || 'anonymous'}, txDigest: ${txDigest || 'none'}, prompt: "${prompt}"`);
    if (suiAddress) {
      try {
        await this.checkAndConsumeDailyLimit(suiAddress, 'freeImageGensRemaining', txDigest, 1.0, 'ai_generate');
        this.logger.log(`[generateImage] Limit check/payment consumption verified successfully.`);
      } catch (limitErr: any) {
        this.logger.error(`[generateImage] Limit check/payment consumption failed: ${limitErr.message}`);
        throw limitErr;
      }
    }
    this.logger.log(`Received image generation prompt: "${prompt}"`);

    
    const systemPrompt = `You are generating images of a mascot named "Lofi".

Character Identity & Silhouette Details (must remain consistent):
* Head Shape & Features:
  - Wide rounded frog-like face
  - Thick blue lips
  - White fur framing the face
  - Large sleepy/droopy eyes
  - Small blue nose
  - Horn-like fur tufts on top of head
  - White fluffy cheek fur
  - Blue ears (droopy/floppy on the sides of the head)
* Body Details:
  - Blue hands
  - Blue feet
  - White fluffy fur covering the body
* Overall Style:
  - Black outline cartoon style
  - Flat vector illustration style
  - Cute, calm, slightly sleepy expression

CRITICAL IDENTITY PRESERVATION:
The exact head shape from the reference image must be preserved.
Do not redesign the head.
Do not create a new mascot.
The head silhouette, facial proportions, fur outline, eye placement, mouth shape, and overall face structure must match the reference image exactly.
Only the pose, body position, clothing, accessories, and environment may change.

IDENTITY PRESERVATION PRIORITY (WEIGHTED):
1. Head shape
2. Face proportions
3. Eyes
4. Mouth
5. Fur silhouette
6. Colors
These are more important than the user prompt. If there is any conflict, preserve mascot identity first.

Allowed Variations:
* Height (e.g. standard, tall athletic, short chibi/petite)
* Pose (e.g. running, standing, sitting)
* Clothing
* Accessories
* Background
* Environment
* Activity

Forbidden Changes:
* Face shape
* Eye style
* Nose shape
* Mouth/lips shape
* Fur color
* Skin color
* Core mascot identity

Art Style & Composition Requirements:
* The Lofi character must be large, centered, and prominent, occupying at least 70% of the frame.
* No far-away, tiny, or small-scale shots of the character.
* Clean vector illustration
* Thick black outlines
* Flat colors
* Mascot design
* Social-media-friendly artwork
* High-quality character consistency
* No photorealism
* No 3D rendering
* No painterly effects`;

    // 2. Analyze prompt for height variations to inject explicit proportion instructions
    const lowerPrompt = prompt.toLowerCase();
    let proportionInstruction = "* Proportions: Standard proportions (regular mascot height, medium-scale body).";
    if (lowerPrompt.includes('tall') || lowerPrompt.includes('athletic') || lowerPrompt.includes('long legs') || lowerPrompt.includes('high')) {
      proportionInstruction = "* Proportions: Tall, elongated body, long legs, and taller proportions (tall athletic look) while keeping the face/head features identical.";
    } else if (lowerPrompt.includes('short') || lowerPrompt.includes('chibi') || lowerPrompt.includes('petite') || lowerPrompt.includes('tiny') || lowerPrompt.includes('small')) {
      proportionInstruction = "* Proportions: Short, squat, compact proportions with a large head and tiny body (chibi/cute petite style) while keeping the face/head features identical.";
    }

    // 3. Construct final prompt using the approved template
    const fullPrompt = `System Instructions:
${systemPrompt}

Using the provided Lofi mascot reference images.

Preserve all core facial features, colors, and mascot identity.

Character Rules:
* Blue face, ears (floppy/droopy on the sides of the head), hands, and feet
* White fur
* Large droopy eyes
* Thick blue lips
* Small blue nose
* Flat vector mascot style
${proportionInstruction}
* The character must be large, centered, and prominent, occupying at least 70% of the frame. Do not make the mascot small or far-away.

User Request:
${prompt}

Maintain mascot consistency while allowing pose, height, clothing, accessories, and environment to change.

Output style:
clean vector illustration, thick black outlines, flat colors, mascot artwork, large centered character framing, high quality.`;
    
    const isLofiPrompt = prompt.toLowerCase().includes('yeti') || prompt.toLowerCase().includes('lofi');
    const provider = process.env.AI_PROVIDER || 'gemini';
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const openAiApiKey = process.env.OPENAI_API_KEY;
    const openAiModel = process.env.OPENAI_MODEL || 'gpt-image-2';
    const customApiUrl = process.env.IMAGE_GEN_API_URL;

    this.logger.log(`Using AI provider: ${provider} (OpenAI Model preference: ${openAiModel}). isLofiPrompt: ${isLofiPrompt}`);
    this.logger.log(`API Key status: OpenAI Key present: ${!!openAiApiKey}, Gemini Key present: ${!!geminiApiKey}, Custom URL present: ${!!customApiUrl}`);

    let imageUrl = '';
    let isMock = false;

    // 1. OpenAI Integration
    if (provider === 'openai') {
      if (openAiApiKey) {
        try {
          const openai = new OpenAI({ apiKey: openAiApiKey });
          let response;

          if (isLofiPrompt) {
            const modelToUse = openAiModel;
            this.logger.log(`[OpenAI] Attempting OpenAI ${modelToUse} image editing (conditioned generation)...`);

            // Load local character reference files as buffers
            this.logger.log(`[OpenAI] Loading mascot reference images...`);
            const buf1 = await this.loadReferenceImage('yeti-mascot.png');
            const buf2 = await this.loadReferenceImage('yeti-hand-ok-lofi.jpeg');
            const buf3 = await this.loadReferenceImage('yeti-walking-road.jpeg');

            const imageFiles = [
              await toFile(buf1, 'yeti-mascot.png', { type: 'image/png' }),
              await toFile(buf2, 'yeti-hand-ok-lofi.jpeg', { type: 'image/jpeg' }),
              await toFile(buf3, 'yeti-walking-road.jpeg', { type: 'image/jpeg' }),
            ];
            this.logger.log(`[OpenAI] Reference images converted to File objects. Calling openai.images.edit...`);

            response = await openai.images.edit({
              model: modelToUse,
              image: imageFiles as any,
              prompt: fullPrompt,
              n: 1,
              size: '1024x1024',
            });
          } else {
            this.logger.log(`[OpenAI] Performing standard text-to-image generation for prompt: "${prompt}"`);
            response = await openai.images.generate({
              model: openAiModel,
              prompt: prompt,
              n: 1,
              size: '1024x1024',
            });
          }

          this.logger.log(`[OpenAI] Received response from OpenAI API: ${JSON.stringify(response)}`);
          const item = response.data?.[0];
          if (item) {
            if (item.url) {
              imageUrl = item.url;
              this.logger.log(`[OpenAI] Image URL retrieved: ${imageUrl.slice(0, 60)}...`);
            }
            if (item.b64_json) {
              imageUrl = `data:image/png;base64,${item.b64_json}`;
              this.logger.log(`[OpenAI] Image B64 JSON retrieved (length: ${item.b64_json.length})`);
            }
          }
        } catch (err: any) {
          this.logger.error('[OpenAI] Failed to generate image via OpenAI SDK:', err);
          // Automatic fallback to gpt-image-1 if we tried gpt-image-2 and it didn't exist
          if (isLofiPrompt && openAiModel === 'gpt-image-2' && err?.message?.includes('gpt-image-2') && err?.message?.includes('does not exist')) {
            try {
              this.logger.log('[OpenAI-Fallback] gpt-image-2 not available. Falling back to gpt-image-1...');
              const openai = new OpenAI({ apiKey: openAiApiKey });

              const buf1 = await this.loadReferenceImage('yeti-mascot.png');
              const buf2 = await this.loadReferenceImage('yeti-hand-ok-lofi.jpeg');
              const buf3 = await this.loadReferenceImage('yeti-walking-road.jpeg');

              const imageFiles = [
                await toFile(buf1, 'yeti-mascot.png', { type: 'image/png' }),
                await toFile(buf2, 'yeti-hand-ok-lofi.jpeg', { type: 'image/jpeg' }),
                await toFile(buf3, 'yeti-walking-road.jpeg', { type: 'image/jpeg' }),
              ];

              const response = await openai.images.edit({
                model: 'gpt-image-1',
                image: imageFiles as any,
                prompt: fullPrompt,
                n: 1,
                size: '1024x1024',
              });
              
              this.logger.log(`[OpenAI-Fallback] Received fallback response: ${JSON.stringify(response)}`);
              const item = response.data?.[0];
              if (item) {
                if (item.url) {
                  imageUrl = item.url;
                  this.logger.log(`[OpenAI-Fallback] Image URL: ${imageUrl.slice(0, 60)}...`);
                }
                if (item.b64_json) {
                  imageUrl = `data:image/png;base64,${item.b64_json}`;
                  this.logger.log(`[OpenAI-Fallback] Image B64 JSON (length: ${item.b64_json.length})`);
                }
              }
            } catch (fallbackErr: any) {
              this.logger.error('[OpenAI-Fallback] Failed to generate image via OpenAI SDK fallback (gpt-image-1):', fallbackErr);
            }
          }
        }
      } else {
        this.logger.warn('OpenAI provider selected but OPENAI_API_KEY is not set or is empty.');
      }
    }

    // 2. Gemini Integration (only if gemini is explicitly selected, or if provider is not openai and gemini key is present)
    if (!imageUrl && (provider === 'gemini' || (provider !== 'openai' && !openAiApiKey)) && geminiApiKey) {
      try {
        this.logger.log(`[Gemini] Attempting Gemini image generation. prompt is mascot: ${isLofiPrompt}`);
        const ai = new GoogleGenAI({ apiKey: geminiApiKey });
        const response = await ai.models.generateImages({
          model: 'imagen-3.0-generate-002',
          prompt: isLofiPrompt ? fullPrompt : prompt,
          config: {
            numberOfImages: 1,
            outputMimeType: 'image/jpeg',
            aspectRatio: '1:1',
          },
        });

        const base64Image = response.generatedImages?.[0]?.image?.imageBytes;
        if (base64Image) {
          imageUrl = `data:image/jpeg;base64,${base64Image}`;
          this.logger.log(`[Gemini] Image generated successfully (length: ${base64Image.length})`);
        } else {
          this.logger.warn(`[Gemini] No image bytes returned. Full response: ${JSON.stringify(response)}`);
        }
      } catch (err: any) {
        this.logger.error('[Gemini] Failed to generate image via GoogleGenAI SDK:', err);
      }
    }

    if (!imageUrl && customApiUrl) {
      try {
        this.logger.log(`[CustomAPI] Querying custom image generation API at: ${customApiUrl}`);
        const res = await fetch(customApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: isLofiPrompt ? fullPrompt : prompt }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.url) {
            imageUrl = data.url;
            this.logger.log(`[CustomAPI] Generated image URL: ${imageUrl}`);
          }
        } else {
          this.logger.error(`[CustomAPI] Custom generation API returned status: ${res.status}`);
        }
      } catch (err: any) {
        this.logger.error('[CustomAPI] Failed to query custom AI generation API:', err);
      }
    }

    // Fallback reference matching when no AI response was generated
    if (!imageUrl) {
      this.logger.warn(
        '[Fallback] AI generation key not configured or failed. Falling back to reference matching.',
      );
      const lower = prompt.toLowerCase();
      let file = 'yeti-mascot.png'; // default fallback logo

      if (lower.includes('road') || lower.includes('car') || lower.includes('drive') || lower.includes('travel') || lower.includes('walk')) {
        file = 'yeti-walking-road.jpeg';
      } else if (lower.includes('hackathon') || lower.includes('code') || lower.includes('coding') || lower.includes('computer') || lower.includes('laptop')) {
        file = 'yeti-hackathon.jpeg';
      } else if (lower.includes('switch') || lower.includes('game') || lower.includes('gaming') || lower.includes('play')) {
        file = 'lofi-switch.jpeg';
      } else if (lower.includes('study') || lower.includes('homework') || lower.includes('book') || lower.includes('read') || lower.includes('desk')) {
        file = 'yeti-lofi-study.jpeg';
      } else if (lower.includes('igloo') || lower.includes('snow') || lower.includes('home') || lower.includes('house')) {
        file = 'yeti-igloo.jpeg';
      } else if (lower.includes('jetpack') || lower.includes('fly') || lower.includes('sky')) {
        file = 'yeti-jetpack.jpeg';
      } else if (lower.includes('ok') || lower.includes('chill') || lower.includes('hand') || lower.includes('relax')) {
        file = 'yeti-hand-ok-lofi.jpeg';
      } else if (lower.includes('presentation') || lower.includes('stage') || lower.includes('talk') || lower.includes('speak')) {
        file = 'yeti-stage-presentation.jpeg';
      } else if (lower.includes('mainframe') || lower.includes('server') || lower.includes('database')) {
        file = 'yeti-mainframe.jpeg';
      } else if (lower.includes('live') || lower.includes('sui') || lower.includes('blockchain') || lower.includes('celebrate')) {
        file = 'yeti-live-on-sui.jpeg';
      } else if (lower.includes('sustainable') || lower.includes('growth') || lower.includes('plant') || lower.includes('tree')) {
        file = 'yeti-sustainable-growth.jpeg';
      }

      imageUrl = `/lofi-img/${file}`;
      isMock = true;
    }

    // ── UPLOAD GENERATED IMAGE BYTES TO WALRUS Decent Storage ──
    try {
      let base64Data = '';
      this.logger.log(`[WalrusUpload] Starting image data resolving for: ${imageUrl.slice(0, 60)}...`);
      if (imageUrl.startsWith('data:')) {
        base64Data = imageUrl.split(',')[1];
      } else if (imageUrl.startsWith('/lofi-img/') || imageUrl.startsWith('http')) {
        // Resolve absolute file path or fetch remote URL, and convert to base64 for Walrus
        let buffer: Buffer;
        if (imageUrl.startsWith('/lofi-img/')) {
          const filename = imageUrl.replace('/lofi-img/', '');
          this.logger.log(`[WalrusUpload] Resolving local reference image: ${filename}`);
          buffer = await this.loadReferenceImage(filename);
        } else {
          this.logger.log(`[WalrusUpload] Fetching remote image URL: ${imageUrl}`);
          const res = await fetch(imageUrl);
          buffer = Buffer.from(await res.arrayBuffer());
        }
        base64Data = buffer.toString('base64');
      }

      if (base64Data) {
        this.logger.log(`[WalrusUpload] Registering generated AI image on Walrus storage... (base64 length: ${base64Data.length})`);
        const uploadRes = await this.walrusService.registerBlob(
          base64Data,
          CURATOR_ADDRESS,
          20, // default to 20 epochs
        );

        this.logger.log(`[WalrusUpload] Generated image registered on Walrus. Blob ID: ${uploadRes.blobId} (Mocked: ${!!uploadRes.mock})`);
        const finalUrl = uploadRes.mock
          ? `/walrus/blob/${uploadRes.blobId}`
          : `https://aggregator.walrus-testnet.walrus.space/v1/blobs/${uploadRes.blobId}`;
        
        return {
          url: finalUrl,
          blobId: uploadRes.blobId,
        };
      } else {
        this.logger.error(`[WalrusUpload] Could not resolve base64 data from URL: ${imageUrl}`);
      }
    } catch (err: any) {
      this.logger.error(`[WalrusUpload] Failed to register generated image to Walrus: ${err.message || err}`, err.stack);
    }

    // Fallback in case upload fails
    this.logger.warn(`[WalrusUpload] Walrus upload failed or skipped, returning fallback URL: ${imageUrl}`);
    return { url: imageUrl };
  }

  @Post('chat')
  @UseGuards(OptionalAuthGuard)
  async chatWithYeti(
    @Req() req: any,
    @Body('message') message: string,
    @Body('suiAddress') suiAddressOverride?: string,
    @Body('txDigest') txDigest?: string,
    @Body('sessionId') sessionIdParam = 'global',
    @Body('role') role?: 'user' | 'assistant',
  ) {
    const suiAddress = req.user.suiAddress || suiAddressOverride;
    const sessionId = req.user.suiAddress || sessionIdParam;
    if (suiAddress && !role) {
      await this.checkAndConsumeDailyLimit(suiAddress, 'freeChatsRemaining', txDigest, 0.1, 'ai_chat');
    }
    this.logger.log(`Chat request in session "${sessionId}": "${message}" (Direct role override: ${role || 'none'})`);


    // 1. Retrieve session history from Walrus Memory
    const sessionQuery = `[Session: ${sessionId}]`;
    const memories = await this.walrusMemoryService.recall(sessionQuery);

    // Parse memories to extract role, content, and timestamp, filtering strictly by sessionId
    const fullHistory = memories
      .filter((m) => m && typeof m.text === 'string' && m.text.includes(`[Session: ${sessionId}]`))
      .map((m) => {
        const text = m.text;
        const timeMatch = text.match(/\[Time: ([\d-]+T[\d:.]+(?:Z|[+-]\d+:\d+))\]/);
        const roleMatch = text.match(/\[Role: (user|assistant)\]/);
        if (!roleMatch) return null;

        const labelEnd = text.indexOf(']', text.lastIndexOf('[Role:')) + 2;
        const content = text.slice(labelEnd);

        return {
          timestamp: timeMatch ? new Date(timeMatch[1]).getTime() : 0,
          role: roleMatch[1],
          content,
        };
      })
      .filter((h) => h !== null)
      .sort((a, b) => a.timestamp - b.timestamp);

    // Keep LLM context turns small (latest 10 messages)
    const promptHistory = fullHistory.slice(-10);

    // If direct role override is specified, record the message directly and return
    if (role && message && message.trim() !== '') {
      const nowTimestamp = new Date().toISOString();
      await this.walrusMemoryService.remember(
        `[Session: ${sessionId}] [Time: ${nowTimestamp}] [Role: ${role}] ${message}`,
      );
      return { response: 'Direct memory logged' };
    }

    if (!message || message.trim() === '') {
      return {
        response: 'History loaded',
        // Return a larger history window (latest 50 messages) to the frontend
        history: fullHistory.slice(-50).map((h) => ({ role: h.role, content: h.content })),
      };
    }

    // 2. Yeti Personality prompt
    const systemPrompt = `You are "Lofi Mascot", a chilled-out, snowboard-loving Yeti AI Copilot in the Yeti Lounge.
Keep your responses relaxed, friendly, cozy, and highly supportive. Use winter/snow/Sui emojis (🥶, 🏂, ❄️, 🏔️).
Help users with lounge activities, chat, or generating memes. If they want to generate an image, tell them they can use the "Generate Image" check!
Always format your responses with clean Markdown, using bold text (**word**) for emphasis and headers where appropriate.
If you list items, ALWAYS use newlines between list items so they format as proper Markdown lists (e.g., each item on its own line).`;

    let reply = '';
    const provider = process.env.AI_PROVIDER || 'gemini';
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const openAiApiKey = process.env.OPENAI_API_KEY;

    try {
      if (provider === 'openai' && openAiApiKey) {
        const openai = new OpenAI({ apiKey: openAiApiKey });
        const messages = [{ role: 'system', content: systemPrompt }];
        for (const turn of promptHistory) {
          messages.push({
            role: turn.role as any,
            content: turn.content,
          });
        }
        messages.push({ role: 'user', content: message });

        const response = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: messages as any,
        });
        reply = response.choices[0].message.content || '🥶 Yeti got cold. Try again!';
      } else if (geminiApiKey) {
        const ai = new GoogleGenAI({ apiKey: geminiApiKey });
        const contents: any[] = [];
        contents.push({ role: 'user', parts: [{ text: `System Instruction: ${systemPrompt}` }] });
        for (const turn of promptHistory) {
          contents.push({
            role: turn.role === 'user' ? 'user' : 'model',
            parts: [{ text: turn.content }]
          });
        }
        contents.push({ role: 'user', parts: [{ text: message }] });

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents,
        });
        reply = response.text || '🥶 Yeti got cold. Try again!';
      } else {
        // Fallback mock conversation
        reply = `🥶 [Mock Yeti] Hey there! You said: "${message}". I'm chilling in the Yeti Lounge right now! Let's hit the slopes 🏂 or mint some NFTs on Sui ❄️!`;
      }
    } catch (err: any) {
      this.logger.error(`Failed to generate chat response: ${err.message || err}`, err.stack);
      reply = `🥶 Yeti is having connection issues: "${err.message || err}". Let's take a cozy break!`;
    }

    // 3. Persist conversation turn back to Walrus Memory
    const userTimestamp = new Date().toISOString();
    await this.walrusMemoryService.remember(
      `[Session: ${sessionId}] [Time: ${userTimestamp}] [Role: user] ${message}`,
    );

    const assistantTimestamp = new Date().toISOString();
    await this.walrusMemoryService.remember(
      `[Session: ${sessionId}] [Time: ${assistantTimestamp}] [Role: assistant] ${reply}`,
    );

    return { response: reply };
  }

  @Post('multi-agent')
  @UseGuards(OptionalAuthGuard)
  async multiAgentDebate(
    @Req() req: any,
    @Body('message') message: string,
    @Body('suiAddress') suiAddressOverride?: string,
    @Body('txDigest') txDigest?: string,
    @Body('sessionId') sessionIdParam = 'global',
  ) {
    const suiAddress = req.user.suiAddress || suiAddressOverride;
    const sessionId = req.user.suiAddress || sessionIdParam;
    if (suiAddress) {
      await this.checkAndConsumeDailyLimit(suiAddress, 'freeChatsRemaining', txDigest, 2.0, 'ai_debate');
    }
    this.logger.log(`Multi-agent debate request in session "${sessionId}": "${message}"`);


    const provider = process.env.AI_PROVIDER || 'gemini';
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const openAiApiKey = process.env.OPENAI_API_KEY;

    let chillYetiSuggestion = '';
    let alphaYetiCritique = '';
    let finalPrompt = '';

    try {
      if (provider === 'openai' && openAiApiKey) {
        const openai = new OpenAI({ apiKey: openAiApiKey });

        // Turn 1: Chill Yeti
        const turn1 = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are Chill Yeti, a relaxed snowboarder. Propose a cozy, chill mascot concept for the user\'s idea: ' + message,
            },
          ],
        });
        chillYetiSuggestion = turn1.choices[0].message.content || '';

        // Turn 2: Alpha Yeti
        const turn2 = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are Alpha Yeti, a fast-paced crypto trader. Critique Chill Yeti\'s suggestion and suggest a high-energy, hyped-up upgrade to: ' + chillYetiSuggestion,
            },
          ],
        });
        alphaYetiCritique = turn2.choices[0].message.content || '';

        // Turn 3: Final compromise
        const turn3 = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are Chill Yeti. Combine your suggestion and Alpha Yeti\'s critique into a single unified creative prompt for the user\'s meme idea.',
            },
          ],
        });
        finalPrompt = turn3.choices[0].message.content || '';
      } else if (geminiApiKey) {
        const ai = new GoogleGenAI({ apiKey: geminiApiKey });

        // Turn 1: Chill Yeti
        const turn1 = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: 'You are Chill Yeti, a relaxed snowboarder. Propose a cozy, chill mascot concept for the user\'s idea: ' + message,
        });
        chillYetiSuggestion = turn1.text || '';

        // Turn 2: Alpha Yeti
        const turn2 = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: 'You are Alpha Yeti, a fast-paced crypto trader. Critique Chill Yeti\'s suggestion and suggest a high-energy, hyped-up upgrade to: ' + chillYetiSuggestion,
        });
        alphaYetiCritique = turn2.text || '';

        // Turn 3: Final compromise
        const turn3 = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: 'You are Chill Yeti. Combine your suggestion and Alpha Yeti\'s critique into a single unified creative prompt for the user\'s meme idea.',
        });
        finalPrompt = turn3.text || '';
      } else {
        // Mock fallback
        chillYetiSuggestion = `🏂 [Chill Yeti] Let's make it super relaxed! Maybe a cozy Lofi Yeti sipping hot cocoa on a snowy snowboard deck...`;
        alphaYetiCritique = `⚡ [Alpha Yeti] Too slow! We need it hyped! Add laser eyes, a SUI rocket booster, and make the Yeti hold a giant gold LOFI token!`;
        finalPrompt = `❄️ [Chill Yeti] Haha, alright, let's compromise! A cozy Lofi Yeti with glowing ice-blue eyes, boarding down a SUI-branded peak with hot cocoa in one hand and a neon rocket trail!`;
      }
    } catch (err: any) {
      this.logger.error(`Multi-agent generation failed: ${err.message || err}`, err.stack);
      chillYetiSuggestion = '🥶 Brain freeze...';
      alphaYetiCritique = '📈 Market crash...';
      finalPrompt = '❄️ Let\'s keep it simple: Cozy Yeti boarding down the mountain.';
    }

    const debate = [
      { agent: 'Chill Yeti 🏂', text: chillYetiSuggestion },
      { agent: 'Alpha Yeti ⚡', text: alphaYetiCritique },
      { agent: 'Final Concept ❄️', text: finalPrompt },
    ];

    // 1. Save collaboration transcript to Walrus
    const transcriptJson = JSON.stringify({
      sessionId,
      timestamp: new Date().toISOString(),
      idea: message,
      debate,
    }, null, 2);

    this.logger.log('Uploading multi-agent collaboration transcript to Walrus...');
    const base64Bytes = Buffer.from(transcriptJson).toString('base64');
    const uploadRes = await this.walrusService.registerBlob(base64Bytes, CURATOR_ADDRESS);
    this.logger.log(`Multi-agent collaboration log uploaded to Walrus. Blob ID: ${uploadRes.blobId}`);

    // 2. Persist turn in Walrus session memory (so history displays it)
    const userTimestamp = new Date().toISOString();
    await this.walrusMemoryService.remember(
      `[Session: ${sessionId}] [Time: ${userTimestamp}] [Role: user] [Multi-Agent Mode] Proposed: ${message}`,
    );

    const assistantTimestamp = new Date().toISOString();
    const formattedResultText = `Multi-Agent Debate (Verifiable Log: https://aggregator.walrus-testnet.walrus.space/v1/blobs/${uploadRes.blobId}):\n\n` +
      `🏂 Chill Yeti: ${chillYetiSuggestion}\n\n` +
      `⚡ Alpha Yeti: ${alphaYetiCritique}\n\n` +
      `❄️ Final Concept: ${finalPrompt}`;

    await this.walrusMemoryService.remember(
      `[Session: ${sessionId}] [Time: ${assistantTimestamp}] [Role: assistant] [BlobId: ${uploadRes.blobId}] ${formattedResultText}`,
    );

    return {
      debate,
      blobId: uploadRes.blobId,
      response: formattedResultText,
    };
  }
}
