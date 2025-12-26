
export enum SessionStatus {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  ACTIVE = 'ACTIVE',
  ERROR = 'ERROR'
}

export interface Transaction {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  type: 'debit' | 'credit';
  category: string;
}

export interface AccountInfo {
  accountNumber: string;
  balance: number;
  currency: string;
  owner: string;
  status: 'ACTIVE' | 'FLAGGED' | 'LOCKED';
}

export interface TranscriptionItem {
  sender: 'user' | 'nexus';
  text: string;
  timestamp: Date;
}

export enum SecurityLevel {
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  VERIFIED = 'VERIFIED',
  HIGH_RISK = 'HIGH_RISK'
}
