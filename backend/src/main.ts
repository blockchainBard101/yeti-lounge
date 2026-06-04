import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Enable CORS so the Next.js browser app can query endpoints
  app.enableCors();
  
  // Increase payload limits for handling large base64 image uploads (e.g. Walrus registration)
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));
  
  // Bind backend to port 4000 by default (avoids clashing with frontend on 3000)
  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
