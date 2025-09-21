import {
  BatchTransferRequest,
  ChainInfo,
  ChainsResponse,
  ChainTokensResponse,
  DomainSeparatorResponse,
  EventListener,
  GasEstimateApiResponse,
  HealthApiResponse,
  HealthResponse,
  NonceApiResponse,
  PrepareSignatureResponse,
  QuoteResponse,
  RelayTransferResponse,
  SignatureData,
  SmoothSendConfig,
  SmoothSendError,
  SupportedChain,
  TokenBalance,
  TokenInfo,
  TransferEvent,
  TransferQuote,
  TransferRequest,
  TransferResult,
  TransferStatusApiResponse
} from '../types';
import { HttpClient } from '../utils/http';

export class SmoothSendSDK {
  private httpClient: HttpClient;
  private eventListeners: EventListener[] = [];
  private config: SmoothSendConfig;

  constructor(config: SmoothSendConfig = {}) {
    this.config = {
      timeout: config.timeout || 30000,
      retries: config.retries || 3,
      ...config
    };

    const apiGatewayUrl = 'https://api.smoothsend.xyz';

    this.httpClient = new HttpClient(
      apiGatewayUrl,
      this.config.timeout
    );
  }

  // Event handling
  public addEventListener(listener: EventListener): void {
    this.eventListeners.push(listener);
  }

  public removeEventListener(listener: EventListener): void {
    const index = this.eventListeners.indexOf(listener);
    if (index > -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  private emitEvent(event: TransferEvent): void {
    this.eventListeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in event listener:', error);
      }
    });
  }

  public async getQuote(request: TransferRequest): Promise<TransferQuote> {
    this.emitEvent({
      type: 'transfer_initiated',
      data: { request },
      timestamp: Date.now(),
      chain: request.chain
    });

    try {
      const quoteRequest = {
        chainName: request.chain === 'avalanche' ? 'avalanche-fuji' : request.chain,
        token: request.token,
        amount: request.amount
      };

      const response = await this.httpClient.post<QuoteResponse>('/quote', quoteRequest);

      if (!response.success || !response.data) {
        throw new SmoothSendError(
          response.error || 'Failed to get quote',
          'QUOTE_ERROR',
          request.chain
        );
      }

      return {
        amount: response.data.amount,
        relayerFee: response.data.relayerFee,
        total: response.data.total,
        feePercentage: response.data.feePercentage,
        contractAddress: response.data.contractAddress
      };
    } catch (error) {
      this.emitEvent({
        type: 'transfer_failed',
        data: { error: error instanceof Error ? error.message : String(error), step: 'quote' },
        timestamp: Date.now(),
        chain: request.chain
      });
      throw error;
    }
  }

  public async prepareSignature(
    request: TransferRequest,
    quote: TransferQuote
  ): Promise<SignatureData> {
    try {
      const nonce = await this.getNonce(request.chain, request.from);

      const prepareRequest = {
        chainName: request.chain === 'avalanche' ? 'avalanche-fuji' : request.chain,
        from: request.from,
        to: request.to,
        tokenSymbol: request.token,
        amount: request.amount,
        relayerFee: quote.relayerFee,
        nonce: nonce,
        deadline: Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
      };

      const response = await this.httpClient.post<PrepareSignatureResponse>('/prepare-signature', prepareRequest);

      if (!response.success || !response.data) {
        throw new SmoothSendError(
          response.error || 'Failed to prepare signature',
          'SIGNATURE_PREP_ERROR',
          request.chain
        );
      }

      return {
        domain: response.data.typedData.domain,
        types: response.data.typedData.types,
        message: response.data.typedData.message,
        primaryType: response.data.typedData.primaryType || 'Transfer',
        messageHash: response.data.messageHash
      };
    } catch (error) {
      this.emitEvent({
        type: 'transfer_failed',
        data: { error: error instanceof Error ? error.message : String(error), step: 'prepare' },
        timestamp: Date.now(),
        chain: request.chain
      });
      throw error;
    }
  }

  public async executeTransfer(
    request: TransferRequest,
    quote: TransferQuote,
    signature: string,
    nonce: string,
    deadline: number,
    permitData?: any
  ): Promise<TransferResult> {
    this.emitEvent({
      type: 'transfer_submitted',
      data: { request, signature },
      timestamp: Date.now(),
      chain: request.chain
    });

    try {
      const transferRequest = {
        chainName: request.chain === 'avalanche' ? 'avalanche-fuji' : request.chain,
        from: request.from,
        to: request.to,
        tokenSymbol: request.token,
        amount: request.amount,
        relayerFee: quote.relayerFee,
        nonce: nonce,
        deadline: deadline,
        signature,
        ...(permitData && { permitData })
      };

      const response = await this.httpClient.post<RelayTransferResponse>('/relay-transfer', transferRequest);

      if (!response.success || !response.data) {
        throw new SmoothSendError(
          response.error || 'Transfer execution failed',
          'EXECUTION_ERROR',
          request.chain
        );
      }

      this.emitEvent({
        type: 'transfer_confirmed',
        data: { result: response.data },
        timestamp: Date.now(),
        chain: request.chain
      });

      return {
        success: true,
        transferId: response.data.transferId,
        txHash: response.data.txHash,
        blockNumber: response.data.blockNumber,
        gasUsed: response.data.gasUsed,
        explorerUrl: response.data.explorerUrl,
        fee: response.data.fee,
        executionTime: response.data.executionTime
      };
    } catch (error) {
      this.emitEvent({
        type: 'transfer_failed',
        data: { error: error instanceof Error ? error.message : String(error), step: 'execute' },
        timestamp: Date.now(),
        chain: request.chain
      });
      throw error;
    }
  }

  public async transfer(
    request: TransferRequest,
    signer: any
  ): Promise<TransferResult> {
    const quote = await this.getQuote(request);

    const signatureData = await this.prepareSignature(request, quote);

    let signature: string;

    if (request.chain === 'avalanche') {
      signature = await signer.signTypedData(
        signatureData.domain,
        signatureData.types,
        signatureData.message
      );
    } else {
      throw new SmoothSendError(
        `Unsupported chain: ${request.chain}`,
        'UNSUPPORTED_CHAIN'
      );
    }

    this.emitEvent({
      type: 'transfer_signed',
      data: { signature },
      timestamp: Date.now(),
      chain: request.chain
    });

    const nonce = await this.getNonce(request.chain, request.from);
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    return await this.executeTransfer(request, quote, signature, nonce, deadline);
  }

  public async batchTransfer(
    request: BatchTransferRequest,
    signer: any
  ): Promise<TransferResult> {
    try {
      // Format request to match swagger BatchRelayTransferRequest
      const batchRequest = {
        chainName: request.chain === 'avalanche' ? 'avalanche-fuji' : request.chain,
        transfers: request.transfers.map(transfer => ({
          from: transfer.from,
          to: transfer.to,
          token: transfer.token, // This should be token address, not symbol
          amount: transfer.amount,
          relayerFee: "1000", // This should come from quotes
          nonce: "0", // This should come from nonce endpoint
          deadline: Math.floor(Date.now() / 1000) + 3600,
          signature: "0x" + "0".repeat(130), // Placeholder - needs proper signing
          // permitData is optional
        }))
      };

      const response = await this.httpClient.post<RelayTransferResponse>('/relay-batch-transfer', batchRequest);

      if (!response.success || !response.data) {
        // Fallback to sequential transfers
        const results: TransferResult[] = [];

        for (const transfer of request.transfers) {
          try {
            const result = await this.transfer(transfer, signer);
            results.push(result);
          } catch (error) {
            results.push({
              success: false,
              txHash: '',
              error: error instanceof Error ? error.message : String(error)
            } as TransferResult & { error: string });
          }
        }

        // Return first result for compatibility
        return results[0] || { success: false, txHash: '', error: 'No transfers completed' } as TransferResult;
      }

      // Response format matches swagger RelayTransferResponse
      return {
        success: true,
        transferId: response.data.transferId,
        txHash: response.data.txHash,
        blockNumber: response.data.blockNumber,
        gasUsed: response.data.gasUsed,
        explorerUrl: response.data.explorerUrl,
        fee: response.data.fee,
        executionTime: response.data.executionTime
      };
    } catch (error) {
      throw new SmoothSendError(
        `Batch transfer failed: ${error instanceof Error ? error.message : String(error)}`,
        'BATCH_TRANSFER_ERROR',
        request.chain
      );
    }
  }

  public async getBalance(
    chain: SupportedChain,
    address: string,
    token?: string
  ): Promise<TokenBalance[]> {
    throw new SmoothSendError(
      'Balance endpoint not available in current API. Use external blockchain RPC instead.',
      'ENDPOINT_NOT_AVAILABLE',
      chain
    );
  }

  public async getTokenInfo(chain: SupportedChain, token: string): Promise<TokenInfo> {
    try {
      const tokens = await this.getChainTokens(chain);
      const tokenInfo = tokens.find(t => t.symbol === token || t.address === token);

      if (!tokenInfo) {
        throw new SmoothSendError(
          `Token ${token} not found for chain ${chain}`,
          'TOKEN_NOT_FOUND',
          chain
        );
      }

      return tokenInfo;
    } catch (error) {
      if (error instanceof SmoothSendError) throw error;
      throw new SmoothSendError(
        `Token info query failed: ${error instanceof Error ? error.message : String(error)}`,
        'TOKEN_INFO_ERROR',
        chain
      );
    }
  }

  public async getNonce(chain: SupportedChain, address: string): Promise<string> {
    try {
      const chainName = chain === 'avalanche' ? 'avalanche-fuji' : chain;
      const response = await this.httpClient.get<NonceApiResponse>('/nonce', {
        params: {
          chainName: chainName,
          userAddress: address
        }
      });

      if (!response.success || !response.data) {
        throw new SmoothSendError(
          response.error || 'Failed to get nonce',
          'NONCE_ERROR',
          chain
        );
      }

      return response.data.nonce;
    } catch (error) {
      if (error instanceof SmoothSendError) throw error;
      throw new SmoothSendError(
        `Nonce query failed: ${error instanceof Error ? error.message : String(error)}`,
        'NONCE_ERROR',
        chain
      );
    }
  }

  public async getTransferStatus(chain: SupportedChain, transferHash: string): Promise<any> {
    try {
      const chainName = chain === 'avalanche' ? 'avalanche-fuji' : chain;
      const response = await this.httpClient.get<TransferStatusApiResponse>('/transfer-status', {
        params: {
          chainName: chainName,
          transferHash: transferHash
        }
      });

      if (!response.success || !response.data) {
        throw new SmoothSendError(
          response.error || 'Failed to get transfer status',
          'STATUS_ERROR',
          chain
        );
      }

      return {
        chainName: response.data.chainName,
        transferHash: response.data.transferHash,
        executed: response.data.executed
      };
    } catch (error) {
      if (error instanceof SmoothSendError) throw error;
      throw new SmoothSendError(
        `Transfer status query failed: ${error instanceof Error ? error.message : String(error)}`,
        'STATUS_ERROR',
        chain
      );
    }
  }

  public async validateAddress(chain: SupportedChain, address: string): Promise<boolean> {
    if (chain === 'avalanche') {
      return /^0x[a-fA-F0-9]{40}$/.test(address);
    }
    return false;
  }

  public async validateAmount(
    chain: SupportedChain,
    amount: string,
    token: string
  ): Promise<boolean> {
    return /^\d+$/.test(amount) && parseInt(amount) > 0;
  }

  public async getSupportedChains(): Promise<ChainInfo[]> {
    try {
      const response = await this.httpClient.get<ChainsResponse>('/chains');

      if (!response.success || !response.data) {
        throw new SmoothSendError(
          response.error || 'Failed to get supported chains',
          'CHAINS_ERROR'
        );
      }

      return response.data.chains;
    } catch (error) {
      if (error instanceof SmoothSendError) throw error;
      throw new SmoothSendError(
        `Chains query failed: ${error instanceof Error ? error.message : String(error)}`,
        'CHAINS_ERROR'
      );
    }
  }

  public async getChainTokens(chain: SupportedChain): Promise<TokenInfo[]> {
    try {
      const chainName = chain === 'avalanche' ? 'avalanche-fuji' : chain;
      const response = await this.httpClient.get<ChainTokensResponse>(`/chains/${chainName}/tokens`);

      if (!response.success || !response.data) {
        throw new SmoothSendError(
          response.error || 'Failed to get chain tokens',
          'CHAIN_TOKENS_ERROR',
          chain
        );
      }

      return response.data.tokens;
    } catch (error) {
      if (error instanceof SmoothSendError) throw error;
      throw new SmoothSendError(
        `Chain tokens query failed: ${error instanceof Error ? error.message : String(error)}`,
        'CHAIN_TOKENS_ERROR',
        chain
      );
    }
  }

  public async getDomainSeparator(chain: SupportedChain): Promise<string> {
    try {
      const chainName = chain === 'avalanche' ? 'avalanche-fuji' : chain;
      const response = await this.httpClient.get<DomainSeparatorResponse>(`/domain-separator/${chainName}`);

      if (!response.success || !response.data) {
        throw new SmoothSendError(
          response.error || 'Failed to get domain separator',
          'DOMAIN_SEPARATOR_ERROR',
          chain
        );
      }

      return response.data.domainSeparator;
    } catch (error) {
      if (error instanceof SmoothSendError) throw error;
      throw new SmoothSendError(
        `Domain separator query failed: ${error instanceof Error ? error.message : String(error)}`,
        'DOMAIN_SEPARATOR_ERROR',
        chain
      );
    }
  }

  public async estimateGas(chain: SupportedChain, transfers: any[]): Promise<any> {
    try {
      const chainName = chain === 'avalanche' ? 'avalanche-fuji' : chain;
      const response = await this.httpClient.post<GasEstimateApiResponse>('/estimate-gas', {
        chainName: chainName,
        transfers: transfers
      });

      if (!response.success || !response.data) {
        throw new SmoothSendError(
          response.error || 'Failed to estimate gas',
          'GAS_ESTIMATE_ERROR',
          chain
        );
      }

      return {
        chainName: response.data.chainName,
        gasEstimate: response.data.gasEstimate,
        gasPrice: response.data.gasPrice,
        estimatedCost: response.data.estimatedCost,
        transferCount: response.data.transferCount
      };
    } catch (error) {
      if (error instanceof SmoothSendError) throw error;
      throw new SmoothSendError(
        `Gas estimation failed: ${error instanceof Error ? error.message : String(error)}`,
        'GAS_ESTIMATE_ERROR',
        chain
      );
    }
  }

  public async getHealth(): Promise<HealthResponse> {
    try {
      const response = await this.httpClient.get<HealthApiResponse>('/health');

      if (!response.success || !response.data) {
        throw new SmoothSendError(
          response.error || 'Health check failed',
          'HEALTH_CHECK_ERROR'
        );
      }

      return {
        status: response.data.status,
        timestamp: response.data.timestamp,
        version: response.data.version
      };
    } catch (error) {
      if (error instanceof SmoothSendError) throw error;
      throw new SmoothSendError(
        `Health check failed: ${error instanceof Error ? error.message : String(error)}`,
        'HEALTH_CHECK_ERROR'
      );
    }
  }
}