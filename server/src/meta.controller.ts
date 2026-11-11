import { Controller, Get } from '@nestjs/common';
import { BUILD_INFO } from './build-info.js';

@Controller('api/v1/meta')
export class MetaController {
  @Get('version')
  getVersion() {
    return BUILD_INFO;
  }
}
