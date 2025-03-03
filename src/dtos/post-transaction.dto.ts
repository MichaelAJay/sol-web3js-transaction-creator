export class PostTransactionDto {
  destination: string;
  amount: number;
  nonceAddress?: string;
  version: 0 | 'legacy';
}
