import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Enable CORS so the Next.js browser app can query endpoints
  app.enableCors();
  
  // Bind backend to port 4000 by default (avoids clashing with frontend on 3000)
  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
