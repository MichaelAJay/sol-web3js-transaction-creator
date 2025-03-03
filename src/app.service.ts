import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  getCreateAccountInstruction,
  getInitializeNonceAccountInstruction,
  getTransferSolInstruction,
  SYSTEM_PROGRAM_ADDRESS,
} from '@solana-program/system';
import {
  createSolanaRpc,
  sendAndConfirmTransactionFactory,
  sendAndConfirmDurableNonceTransactionFactory,
  KeyPairSigner,
  Rpc,
  SolanaRpcApiDevnet,
  createSolanaRpcSubscriptions,
  RpcSubscriptions,
  SolanaRpcSubscriptionsApi,
  createKeyPairSignerFromPrivateKeyBytes,
  generateKeyPairSigner,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  Nonce,
  Lamports,
  Address,
  address,
  setTransactionMessageLifetimeUsingDurableNonce,
  lamports,
  setTransactionMessageFeePayer,
} from '@solana/web3.js';
import { pipe } from '@solana/functional';
import bs58 from 'bs58';

@Injectable()
export class AppService implements OnModuleInit {
  serviceUrl: string;
  rpc: Rpc<SolanaRpcApiDevnet>;
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>;
  authorityAndPayer: KeyPairSigner<string>;
  receiver: KeyPairSigner<string>;
  recipient: KeyPairSigner<string>;

  constructor() {
    try {
      const serviceUrl = process.env.SOLANA_RPC_SERVICE_URL;
      if (!serviceUrl) {
        throw new Error('Missing SOLANA_RPC_SERVICE_URL env var');
      }

      this.serviceUrl = serviceUrl;
      this.rpc = createSolanaRpc(this.serviceUrl);
      this.rpcSubscriptions = createSolanaRpcSubscriptions(
        this.serviceUrl.replace('http', 'ws'),
      );
    } catch (err) {
      console.error('AppService could not be initialized - exiting', err);
      process.exit(1);
    }
  }

  async onModuleInit() {
    try {
      const payerPrivateKey = process.env.PAYER_PRIVATE_KEY;
      const receiverPrivateKey = process.env.RECEIVER_PRIVATE_KEY;
      if (!(payerPrivateKey && receiverPrivateKey)) {
        throw new Error('PAYER_PRIVATE_KEY missing from env vars');
      }

      const [authorityAndPayer, receiver] = await Promise.all(
        [payerPrivateKey, receiverPrivateKey].map(async (key) => {
          return await createKeyPairSignerFromPrivateKeyBytes(
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            bs58.decode(key),
          );
        }),
      );

      this.authorityAndPayer = authorityAndPayer;
      this.receiver = receiver;

      console.log(
        'Authority & payer initialized, address:',
        this.authorityAndPayer.address,
      );
      console.log('Receiver initialized, address:', this.receiver.address);
    } catch (err) {
      console.error('AppService initialized failed, exiting', err);
      process.exit(1);
    }
  }

  async createTransfer({
    destination,
    amount,
    nonceAddress,
    version,
  }: {
    destination: string;
    amount: number;
    nonceAddress?: string;
    version: 0 | 'legacy';
  }) {
    const bigIntAmt = amount as unknown as bigint;
    try {
      return nonceAddress
        ? await this.createNonceTransaction({
            destination: address(destination),
            amount: lamports(bigIntAmt),
            nonceAddressStr: nonceAddress,
            version,
            keypairSigner: this.authorityAndPayer,
          })
        : await this.createTransaction({
            destination: address(destination),
            amount: lamports(bigIntAmt),
            version,
          });
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      if (err.message.includes('is no longer valid. It has advanced to')) {
        const msg = 'Notification error bug detected. Gracefully handling.';
        console.log(msg);
        return msg;
      }
      console.error('err', err);
      throw err;
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  private async createLegacyTransaction() {
    throw new Error('Not implemented');
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  private async createVersionedTransaction() {
    throw new Error('Not implemented');
  }

  private async createTransaction({
    destination,
    amount,
    version,
  }: {
    destination: Address;
    amount: Lamports;
    version: 0 | 'legacy';
  }) {
    const recentBlockhash = await this.getLatestBlockhash();

    const transferInstruction = getTransferSolInstruction({
      amount,
      destination,
      source: this.authorityAndPayer,
    });

    const transactionMessage = pipe(
      createTransactionMessage({ version }),
      // (tx) => setTransactionMessageFeePayer(this.authorityAndPayer.address, tx),
      (tx) => setTransactionMessageFeePayerSigner(this.authorityAndPayer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(recentBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([transferInstruction], tx),
    );

    const signedTransaction =
      await signTransactionMessageWithSigners(transactionMessage);

    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({
      rpc: this.rpc,
      rpcSubscriptions: this.rpcSubscriptions,
    });
    await sendAndConfirmTransaction(signedTransaction, {
      commitment: 'confirmed',
    });
    return getSignatureFromTransaction(signedTransaction);
  }

  private async createNonceTransaction({
    destination,
    amount,
    nonceAddressStr,
    version,
    keypairSigner,
  }: {
    destination: Address;
    amount: Lamports;
    nonceAddressStr: string;
    version: 0 | 'legacy';
    keypairSigner: KeyPairSigner<string>;
  }) {
    const transferInstruction = getTransferSolInstruction({
      amount,
      destination,
      source: keypairSigner,
    });

    const nonceAccountAddress = address(nonceAddressStr);
    const nonce = await this.getNonce(nonceAccountAddress);
    const createTransactionMsg = createTransactionMessage({ version });
    const transferTxMessage = pipe(
      createTransactionMsg,
      (tx) => setTransactionMessageFeePayerSigner(this.receiver, tx),
      (tx) =>
        setTransactionMessageLifetimeUsingDurableNonce(
          {
            nonce,
            nonceAccountAddress,
            nonceAuthorityAddress: this.authorityAndPayer.address,
          },
          tx,
        ),
      (tx) => appendTransactionMessageInstructions([transferInstruction], tx),
    );

    // Sign & send
    const signedTransferNonceTx =
      await signTransactionMessageWithSigners(transferTxMessage);
    const sendAndConfirmNonceTransaction =
      sendAndConfirmDurableNonceTransactionFactory({
        rpc: this.rpc,
        rpcSubscriptions: this.rpcSubscriptions,
      });

    await sendAndConfirmNonceTransaction(signedTransferNonceTx, {
      commitment: 'confirmed',
    });

    console.log(
      'Transfer Tx Signature:',
      getSignatureFromTransaction(signedTransferNonceTx),
    );
    console.log('Nonce-based transfer succeeded!');
  }

  async createNonceAccount() {
    const nonceAccount = await generateKeyPairSigner();

    // Get the min balance for rent exemption
    const space = 80n;
    const lamportsForRent = await this.rpc
      .getMinimumBalanceForRentExemption(space)
      .send();

    // Build the tx
    const createAccountInstruction = getCreateAccountInstruction({
      payer: this.authorityAndPayer,
      newAccount: nonceAccount,
      lamports: lamportsForRent,
      space,
      programAddress: SYSTEM_PROGRAM_ADDRESS,
    });

    const initializeNonceAccountInstruction =
      getInitializeNonceAccountInstruction({
        nonceAccount: nonceAccount.address,
        nonceAuthority: this.authorityAndPayer.address,
      });

    const { blockhash: nonceCreateBlockhash, lastValidBlockHeight } =
      await this.getLatestBlockhash();

    const createNonceTxMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(this.authorityAndPayer, tx),
      (tx) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: nonceCreateBlockhash, lastValidBlockHeight },
          tx,
        ),
      (tx) =>
        appendTransactionMessageInstructions(
          [createAccountInstruction, initializeNonceAccountInstruction],
          tx,
        ),
    );

    // Sign & send
    const signedCreateNonceTx =
      await signTransactionMessageWithSigners(createNonceTxMessage);

    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({
      rpc: this.rpc,
      rpcSubscriptions: this.rpcSubscriptions,
    });
    await sendAndConfirmTransaction(signedCreateNonceTx, {
      commitment: 'confirmed',
    });

    console.log('Nonce account created at:', nonceAccount.address);
    console.log(
      'Creation Tx Signature:',
      getSignatureFromTransaction(signedCreateNonceTx),
    );
    return nonceAccount.address as string;
  }

  // Helpers
  private async getLatestBlockhash() {
    const { value } = await this.rpc
      .getLatestBlockhash({ commitment: 'confirmed' })
      .send();
    return value;
  }

  private bs58EncodeBytes(bytes: Uint8Array<ArrayBuffer>) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const bs58String = bs58.encode(bytes);
    if (typeof bs58String !== 'string') {
      throw new Error('Could not bs58-encode bytes');
    }
    return bs58String;
  }

  private async getNonce(nonceAddress: Address<string>) {
    const NONCE_VALUE_OFFSET = 4 + 4 + 32;
    const { value: nonceAccountInfo } = await this.rpc
      .getAccountInfo(nonceAddress, {
        dataSlice: { offset: NONCE_VALUE_OFFSET, length: 32 },
        encoding: 'base58',
      })
      .send();

    if (!nonceAccountInfo?.data || !nonceAccountInfo.data[0]) {
      throw new Error('Failed to read the new nonce from the account');
    }

    const base58Nonce = nonceAccountInfo.data[0] as string;
    const nonce = base58Nonce as Nonce<string>;
    console.log('Fetched new nonce for second transaction:', base58Nonce);
    return nonce;
  }
}
