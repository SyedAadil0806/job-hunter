import { Controller, Get, Post } from '@nestjs/common';
import { RunNowService } from './run-now.service';

@Controller('run-now')
export class RunNowController {
  constructor(private readonly runNow: RunNowService) {}

  @Get()
  status() {
    return this.runNow.status();
  }

  @Post()
  start() {
    return this.runNow.start();
  }
}
