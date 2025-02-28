import { Body, Controller, Post } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Post()
  createTransfer(
    @Body()
    body: {
      destination: string;
      amount: bigint;
      nonceAddress?: string | undefined;
    },
  ): any {
    return this.appService.createTransfer(body);
  }

  @Post()
  createNonceAccount(): any {
    return this.appService.createNonceAccount();
  }
}
