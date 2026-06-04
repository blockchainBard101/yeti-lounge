import { Controller, Post, Body, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import OpenAI, { toFile } from 'openai';
import * as fs from 'fs';
import * as path from 'path';

@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  @Post('generate')
  async generateImage(@Body('prompt') prompt: string) {
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
    
    const provider = process.env.AI_PROVIDER || 'gemini';
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const openAiApiKey = process.env.OPENAI_API_KEY;
    const openAiModel = process.env.OPENAI_MODEL || 'gpt-image-2';
    const customApiUrl = process.env.IMAGE_GEN_API_URL;

    this.logger.log(`Using AI provider: ${provider} (OpenAI Model preference: ${openAiModel})`);

    // 1. OpenAI Integration
    if (provider === 'openai') {
      if (openAiApiKey) {
        try {
          const modelToUse = openAiModel;
          this.logger.log(`Attempting OpenAI ${modelToUse} image editing (conditioned generation)...`);
          const openai = new OpenAI({ apiKey: openAiApiKey });

          // Load local character reference files as upload streams
          const imagePath1 = path.resolve(process.cwd(), '../frontend/public/lofi-img/yeti-mascot.png');
          const imagePath2 = path.resolve(process.cwd(), '../frontend/public/lofi-img/yeti-hand-ok-lofi.jpeg');
          const imagePath3 = path.resolve(process.cwd(), '../frontend/public/lofi-img/yeti-walking-road.jpeg');

          const imageFiles = [
            await toFile(fs.createReadStream(imagePath1), 'yeti-mascot.png', { type: 'image/png' }),
            await toFile(fs.createReadStream(imagePath2), 'yeti-hand-ok-lofi.jpeg', { type: 'image/jpeg' }),
            await toFile(fs.createReadStream(imagePath3), 'yeti-walking-road.jpeg', { type: 'image/jpeg' }),
          ];

          const response = await openai.images.edit({
            model: modelToUse,
            image: imageFiles as any,
            prompt: fullPrompt,
            n: 1,
            size: '1024x1024',
          });

          const item = response.data?.[0];
          if (item) {
            if (item.url) {
              return { url: item.url };
            }
            if (item.b64_json) {
              return { url: `data:image/png;base64,${item.b64_json}` };
            }
          }
        } catch (err: any) {
          this.logger.error('Failed to generate image via OpenAI SDK:', err);
          // Automatic fallback to gpt-image-1 if we tried gpt-image-2 and it didn't exist
          if (openAiModel === 'gpt-image-2' && err?.message?.includes('gpt-image-2') && err?.message?.includes('does not exist')) {
            try {
              this.logger.log('gpt-image-2 not available. Falling back to gpt-image-1...');
              const openai = new OpenAI({ apiKey: openAiApiKey });

              const imagePath1 = path.resolve(process.cwd(), '../frontend/public/lofi-img/yeti-mascot.png');
              const imagePath2 = path.resolve(process.cwd(), '../frontend/public/lofi-img/yeti-hand-ok-lofi.jpeg');
              const imagePath3 = path.resolve(process.cwd(), '../frontend/public/lofi-img/yeti-walking-road.jpeg');

              const imageFiles = [
                await toFile(fs.createReadStream(imagePath1), 'yeti-mascot.png', { type: 'image/png' }),
                await toFile(fs.createReadStream(imagePath2), 'yeti-hand-ok-lofi.jpeg', { type: 'image/jpeg' }),
                await toFile(fs.createReadStream(imagePath3), 'yeti-walking-road.jpeg', { type: 'image/jpeg' }),
              ];

              const response = await openai.images.edit({
                model: 'gpt-image-1',
                image: imageFiles as any,
                prompt: fullPrompt,
                n: 1,
                size: '1024x1024',
              });
              const item = response.data?.[0];
              if (item) {
                if (item.url) {
                  return { url: item.url };
                }
                if (item.b64_json) {
                  return { url: `data:image/png;base64,${item.b64_json}` };
                }
              }
            } catch (fallbackErr) {
              this.logger.error('Failed to generate image via OpenAI SDK fallback (gpt-image-1):', fallbackErr);
            }
          }
        }
      } else {
        this.logger.warn('OpenAI provider selected but OPENAI_API_KEY is not set or is empty.');
      }
    }

    // 2. Gemini Integration (only if gemini is explicitly selected, or if provider is not openai and gemini key is present)
    if ((provider === 'gemini' || (provider !== 'openai' && !openAiApiKey)) && geminiApiKey) {
      try {
        this.logger.log('Attempting Gemini image generation...');
        const ai = new GoogleGenAI({ apiKey: geminiApiKey });
        const response = await ai.models.generateImages({
          model: 'imagen-3.0-generate-002',
          prompt: fullPrompt,
          config: {
            numberOfImages: 1,
            outputMimeType: 'image/jpeg',
            aspectRatio: '1:1',
          },
        });

        const base64Image = response.generatedImages?.[0]?.image?.imageBytes;
        if (base64Image) {
          return { url: `data:image/jpeg;base64,${base64Image}` };
        }
      } catch (err) {
        this.logger.error('Failed to generate image via GoogleGenAI SDK:', err);
      }
    }

    if (customApiUrl) {
      try {
        const res = await fetch(customApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: fullPrompt }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.url) return { url: data.url };
        }
      } catch (err) {
        this.logger.error('Failed to query custom AI generation API:', err);
      }
    }

    // Graceful fallback matching logic when credentials are not present
    this.logger.warn(
      'Gemini API key not configured. To enable live Imagen 3 generation, set the GEMINI_API_KEY environment variable. Falling back to reference matching.',
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

    return { url: `/lofi-img/${file}` };
  }
}
