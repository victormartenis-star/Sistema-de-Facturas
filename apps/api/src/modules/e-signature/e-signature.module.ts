import { Module } from '@nestjs/common';
import { ESignatureController } from './e-signature.controller';
import { ESignatureService } from './e-signature.service';

@Module({
  controllers: [ESignatureController],
  providers: [ESignatureService],
  exports: [ESignatureService],
})
export class ESignatureModule {}
