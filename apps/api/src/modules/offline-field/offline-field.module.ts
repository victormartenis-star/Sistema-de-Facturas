import { Module } from '@nestjs/common';
import { OfflineFieldController } from './offline-field.controller';
import { OfflineFieldService } from './offline-field.service';

@Module({
  controllers: [OfflineFieldController],
  providers: [OfflineFieldService],
})
export class OfflineFieldModule {}
