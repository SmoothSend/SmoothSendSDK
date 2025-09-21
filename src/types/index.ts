// Simplified SDK Types - Only client-facing types
export type SupportedChain = 'avalanche';

// Core request/response types
export interface TransferRequest {
  from: string;
  to: string;
  token: string;
  amount: string;
  chain: SupportedChain;
}

export interface TransferQuote {
  amount: string;
  relayerFee: string;
  total: string;
  feePercentage: number;
  contractAddress: string;
}

export interface TransferResult {
  success: boolean;
  transferId?: string;
  txHash: string;
  blockNumber?: number;
  gasUsed?: string;
  explorerUrl?: string;
  fee?: string;
  executionTime?: number;
  error?: string;
}

export interface BatchTransferRequest {
  transfers: TransferRequest[];
  chain: SupportedChain;
}

export interface TokenBalance {
  token: string;
  balance: string;
  decimals: number;
  symbol: string;
  name?: string;
}

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

// Signature types (for client-side signing)
export interface SignatureData {
  domain: any;
  types: any;
  message: any;
  primaryType: string;
  messageHash?: string;
}

// SDK Configuration
export interface SmoothSendConfig {
  timeout?: number;
  retries?: number;
  // apiGatewayUrl is internal - set via build-time environment variables
}

// API Response wrapper
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  details?: string[];
  requestId?: string;
}

// Error handling
export class SmoothSendError extends Error {
  constructor(
    message: string,
    public code: string,
    public chain?: SupportedChain,
    public details?: any
  ) {
    super(message);
    this.name = 'SmoothSendError';
  }
}

// Events (optional - you can remove if not needed)
export interface TransferEvent {
  type: 'transfer_initiated' | 'transfer_signed' | 'transfer_submitted' | 'transfer_confirmed' | 'transfer_failed';
  data: any;
  timestamp: number;
  chain: SupportedChain;
}

export type EventListener = (event: TransferEvent) => void;

// Chain info (from API Gateway)
export interface ChainInfo {
  name: string;
  displayName: string;
  chainId: number;
  explorerUrl: string;
  tokens: string[];
}

// Health check
export interface HealthResponse {
  status: string;
  timestamp: string;
  version: string;
}

// Gas estimation response
export interface GasEstimateResponse {
  chainName: string;
  gasEstimate: string;
  gasPrice: string;
  estimatedCost: string;
  transferCount: number;
}

// Transfer status response
export interface TransferStatusResponse {
  chainName: string;
  transferHash: string;
  executed: boolean;
}

// Nonce response
export interface NonceResponse {
  chainName: string;
  userAddress: string;
  nonce: string;
}

// API Response types matching swagger exactly
export interface QuoteResponse {
  chainName: string;
  token: string;
  amount: string;
  relayerFee: string;
  total: string;
  feePercentage: number;
  contractAddress: string;
}

export interface PrepareSignatureResponse {
  typedData: {
    domain: any;
    types: any;
    message: any;
    primaryType?: string;
  };
  messageHash: string;
  message: string;
}

export interface RelayTransferResponse {
  transferId: string;
  txHash: string;
  blockNumber: number;
  gasUsed: string;
  explorerUrl: string;
  fee: string;
  executionTime: number;
}

export interface ChainsResponse {
  chains: ChainInfo[];
}

export interface ChainTokensResponse {
  chainName: string;
  tokens: TokenInfo[];
}

export interface NonceApiResponse {
  chainName: string;
  userAddress: string;
  nonce: string;
}

export interface TransferStatusApiResponse {
  chainName: string;
  transferHash: string;
  executed: boolean;
}

export interface DomainSeparatorResponse {
  chainName: string;
  domainSeparator: string;
}

export interface GasEstimateApiResponse {
  chainName: string;
  gasEstimate: string;
  gasPrice: string;
  estimatedCost: string;
  transferCount: number;
}

export interface HealthApiResponse {
  status: string;
  timestamp: string;
  version: string;
}