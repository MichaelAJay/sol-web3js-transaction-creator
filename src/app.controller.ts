import { Body, Controller, Post } from '@nestjs/common';
import { AppService } from './app.service';
import { PostTransactionDto } from './dtos/post-transaction.dto';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Post('transaction')
  createTransfer(
    @Body()
    body: PostTransactionDto,
  ): any {
    return this.appService.createTransfer(body);
  }

  @Post('create-nonce-acct')
  createNonceAccount(): any {
    return this.appService.createNonceAccount();
  }
}
