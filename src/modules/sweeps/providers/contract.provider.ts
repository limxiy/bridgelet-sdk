import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Contract,
  rpc,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  Address,
  xdr,
  hash,
} from '@stellar/stellar-sdk';
import type { AuthorizeSweepParams } from '../interfaces/authorize-sweep-params.interface.js';
import type { ContractAuthResult } from '../interfaces/contract-auth-result.interface.js';

@Injectable()
export class ContractProvider {
  private readonly logger = new Logger(ContractProvider.name);
  private readonly contractId: string;
  private readonly sorobanRpcUrl: string;
  private readonly networkPassphrase: string;

  constructor(private readonly configService: ConfigService) {
    this.contractId = this.configService.getOrThrow<string>(
      'stellar.contracts.ephemeralAccount',
    );
    this.sorobanRpcUrl = this.configService.getOrThrow<string>(
      'stellar.sorobanRpcUrl',
    );

    const network = this.configService.getOrThrow<string>('stellar.network');
    this.networkPassphrase =
      network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

    this.logger.log(
      `Initialized ContractProvider with contract: ${this.contractId}`,
    );
  }

  /**
   * Authorize sweep via smart contract
   * Calls the contract's sweep() function to validate authorization
   */
  public async authorizeSweep(
    params: AuthorizeSweepParams,
  ): Promise<ContractAuthResult> {
    this.logger.log(
      `Authorizing sweep for account: ${params.ephemeralPublicKey}`,
    );

    try {
      // Create Soroban RPC server connection
      const server = new rpc.Server(this.sorobanRpcUrl);

      // Create contract instance
      const contract = new Contract(this.contractId);

      // Prepare destination address parameter
      const destination = Address.fromString(params.destinationAddress);

      // Generate authorization signature
      // In production, this would be signed by an authorized key
      // For MVP, we create a dummy signature
      const authSignature = this.generateAuthSignature(params);

      // Build contract invocation transaction
      const account = await server.getAccount(params.ephemeralPublicKey);

      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'sweep',
            destination.toScVal(),
            xdr.ScVal.scvBytes(authSignature),
          ),
        )
        .setTimeout(30)
        .build();

      // Simulate contract call first
      const simulated = await server.simulateTransaction(transaction);

      if (rpc.Api.isSimulationError(simulated)) {
        throw new Error(`Contract simulation failed: ${simulated.error}`);
      }

      // For MVP, we don't actually submit this transaction
      // The sweep will be handled by direct Stellar payment
      // In production, this would be submitted to enforce on-chain authorization

      this.logger.log('Contract authorization successful');

      // Generate cryptographically secure authorization hash
      const timestamp = Date.now();
      const authHash = this.generateAuthHash(
        params.ephemeralPublicKey,
        params.destinationAddress,
        timestamp,
      );

      return {
        authorized: true,
        hash: authHash,
        timestamp: new Date(timestamp),
      };
    } catch (error) {
      const typedError = error as Error;
      this.logger.error(
        `Contract execution failed: ${typedError.message}`,
        typedError.stack,
      );
      throw new InternalServerErrorException(
        `Contract execution failed: ${typedError.message}`,
      );
    }
  }

  /**
   * ⚠️ MVP STUB - NOT FOR PRODUCTION USE
   *
   * Generates a fake 64-byte authorization signature for the contract's
   * sweep() function. This works only because EphemeralAccount.verify_sweep_authorization()
   * in bridgelet-core is also a stub that accepts any 64-byte value.
   *
   * WHAT A REAL IMPLEMENTATION MUST DO:
   * - The SDK must hold an authorized Ed25519 signing keypair
   * - The message to sign must be: hash(ephemeralPublicKey + destinationAddress + nonce)
   * - The nonce must match what the SweepController contract tracks to prevent replays
   * - The corresponding public key must be registered in the SweepController
   *   via its initialize() function as the `authorized_signer`
   *
   * Once bridgelet-core replaces its stub with real Ed25519 verification,
   * this method must be replaced before any sweep will succeed on-chain.
   *
   * See: bridgelet-core/contracts/ephemeral_account/src/lib.rs verify_sweep_authorization()
   * See: bridgelet-core/contracts/sweep_controller/src/authorization.rs
   */
  private generateAuthSignature(params: AuthorizeSweepParams): Buffer {
    const isDevelopmentOrTest = ['development', 'test'].includes(
      process.env.NODE_ENV ?? '',
    );
    if (!isDevelopmentOrTest) {
      this.logger.error(
        'CRITICAL: generateAuthSignature() is an MVP stub and must not be called ' +
          `in environment: ${process.env.NODE_ENV}. ` +
          'Implement real Ed25519 signing before deploying to staging or production.',
      );
      throw new Error(
        'Sweep authorization stub cannot be used outside development/test environments. ' +
          'See ContractProvider.generateAuthSignature() for implementation requirements.',
      );
    }
    this.logger.warn(
      '⚠️ Using MVP stub signature for sweep authorization. ' +
        'This only works because bridgelet-core verification is also stubbed.',
    );
    const message = `${params.ephemeralPublicKey}:${params.destinationAddress}`;
    const messageHash = hash(Buffer.from(message));
    const signature = Buffer.alloc(64);
    messageHash.copy(signature, 0);
    return signature;
  }

  /**
   * Check contract status and version
   */
  public getContractInfo(): {
    contractId: string;
    version: string;
  } {
    return {
      contractId: this.contractId,
      version: '0.1.0',
    };
  }
  /**
   * Generate cryptographically secure authorization hash
   * Uses Stellar SDK's SHA-256 hash function for security
   *
   * @param ephemeralKey - The ephemeral account public key
   * @param destination - The destination address for the sweep
   * @param timestamp - Optional timestamp for replay protection (defaults to current time)
   * @returns 64-character hex string of the SHA-256 hash
   */
  public generateAuthHash(
    ephemeralKey: string,
    destination: string,
    timestamp?: number,
  ): string {
    const ts = timestamp ?? Date.now();
    const message = `${ephemeralKey}:${destination}:${ts}`;
    const hashBuffer = hash(Buffer.from(message));
    return hashBuffer.toString('hex');
  }
}
