import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { MetaController } from './meta.controller.js';

@Module({
  controllers: [HealthController, MetaController],
})
export class AppModule {}
