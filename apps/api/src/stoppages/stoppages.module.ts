import { Module } from '@nestjs/common';
import { StoppagesController } from './stoppages.controller';
import { StoppagesService } from './stoppages.service';

@Module({
  controllers: [StoppagesController],
  providers: [StoppagesService],
  exports: [StoppagesService],
})
export class StoppagesModule {}
